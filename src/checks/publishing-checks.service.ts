import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { PublishingLagState } from './schemas/publishing-lag-state'
import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'

type Snapshot = { id: string; slot: number; sha: string; timestamp: number; mined: boolean }

/**
 * What a gateway actually told us about a snapshot.
 *
 * 🚨 `unavailable` is NOT `absent`, and collapsing the two is what made this alarm flap. A 429, a
 * 5xx or a timeout means the GATEWAY failed to answer - it is no evidence whatsoever about the
 * data. arweave.net has rate-limited this cluster before (it blocked the live cutover), and the
 * first cut of this check reported every one of those as "snapshot is NOT retrievable", i.e. as
 * data loss. Only `absent` (the gateway says 404/410) and `corrupt` (bytes came back and the
 * digest is wrong) are durability findings.
 */
type Retrieval = { state: 'ok' | 'absent' | 'corrupt' | 'unavailable'; detail: string }

/**
 * D25 - publishing reliability monitoring.
 *
 * The failure this exists to catch is SILENT non-publishing: `dev_scheduler_server` discards the
 * upload result, so slots advance, `as/` and `now/` stay healthy, and nothing surfaces that
 * assignments stopped reaching Arweave. It has happened twice (8 stage slots lost 2026-08-27; both
 * node wallets dry 2026-09-03) and in both cases every dashboard looked correct throughout.
 */
@Injectable()
export class PublishingChecksService {
  private readonly logger = new Logger(PublishingChecksService.name)

  private readonly nodeUrl: string
  private readonly lagAlertMs: number
  private readonly checkpointMaxAgeMs: number
  private readonly gateways: string[]
  private readonly indexes: string[]
  private readonly snapshotGraceMs: number
  private readonly newProcessGraceMs: number

  // A lag is NORMAL for minutes: our bundler batches on a ~5 min idle flush, then mines, then the
  // gateway indexes. Stage looked exactly like the failure mode for ~4 minutes before four
  // assignments landed at once. Default to 3 flush cycles so a healthy flush never pages anyone.
  static readonly DEFAULT_LAG_ALERT_MS = 30 * 60 * 1000
  // Snapshots publish @daily, so two missed runs is the signal.
  static readonly DEFAULT_CHECKPOINT_MAX_AGE_MS = 48 * 60 * 60 * 1000
  // Propagation is NOT instant, and a snapshot published minutes ago legitimately is not everywhere
  // yet: the bundler flushes on idle, the bundle mines, then each gateway unbundles and seeds the
  // item and each index picks it up on its own schedule. Judging a snapshot the moment it appears
  // is a guaranteed nightly flap right after the 00:00 publish run. Do not judge one younger
  // than this.
  static readonly DEFAULT_SNAPSHOT_GRACE_MS = 2 * 60 * 60 * 1000
  // A process respawned an hour ago has no checkpoint because the @daily job has not run since,
  // not because publishing is broken - live relay-rewards on 2026-09-16. Cover a full publish
  // cycle plus slack before calling that a fault.
  static readonly DEFAULT_NEW_PROCESS_GRACE_MS = 26 * 60 * 60 * 1000

  constructor(
    @InjectModel(PublishingLagState.name)
    private readonly lagState: Model<PublishingLagState>,
    private readonly config: ConfigService<{
      HYPERBEAM_NODE_URL: string
      PUBLISHING_LAG_ALERT_MS: string
      CHECKPOINT_MAX_AGE_MS: string
      PUBLIC_ARWEAVE_GATEWAYS: string
      PUBLIC_ARWEAVE_INDEXES: string
      SNAPSHOT_GRACE_MS: string
      NEW_PROCESS_GRACE_MS: string
    }>,
  ) {
    this.nodeUrl = (this.config.get<string>('HYPERBEAM_NODE_URL', { infer: true }) || '').replace(/\/$/, '')
    this.lagAlertMs =
      parseInt(this.config.get<string>('PUBLISHING_LAG_ALERT_MS', { infer: true }) ?? '', 10) ||
      PublishingChecksService.DEFAULT_LAG_ALERT_MS
    this.checkpointMaxAgeMs =
      parseInt(this.config.get<string>('CHECKPOINT_MAX_AGE_MS', { infer: true }) ?? '', 10) ||
      PublishingChecksService.DEFAULT_CHECKPOINT_MAX_AGE_MS
    this.snapshotGraceMs =
      parseInt(this.config.get<string>('SNAPSHOT_GRACE_MS', { infer: true }) ?? '', 10) ||
      PublishingChecksService.DEFAULT_SNAPSHOT_GRACE_MS
    this.newProcessGraceMs =
      parseInt(this.config.get<string>('NEW_PROCESS_GRACE_MS', { infer: true }) ?? '', 10) ||
      PublishingChecksService.DEFAULT_NEW_PROCESS_GRACE_MS
    // Deliberately NOT the ARWEAVE_GATEWAY_* the refill path uses - that resolves to our OWN ario
    // node, so retrievability measured through it would be us checking ourselves. The SOW asks for
    // PUBLIC gateways.
    //
    // ⚠️ DATA and INDEX gateways are NOT the same thing and must not be conflated. goldsky is a
    // GraphQL INDEX: it serves `/graphql` but 404s on `/<id>`, so listing it as a data gateway
    // produces a permanent false alarm (measured 2026-09-04: 404 on all 6 published snapshots
    // while its GraphQL had every one of them indexed).
    const list = (key: 'PUBLIC_ARWEAVE_GATEWAYS' | 'PUBLIC_ARWEAVE_INDEXES', fallback: string) =>
      (this.config.get<string>(key, { infer: true }) || fallback)
        .split(',')
        .map(g => g.trim().replace(/\/$/, ''))
        .filter(Boolean)

    this.gateways = list('PUBLIC_ARWEAVE_GATEWAYS', 'https://arweave.net')
    this.indexes = list('PUBLIC_ARWEAVE_INDEXES', 'https://arweave.net,https://arweave-search.goldsky.com')
  }

  private async gql(gateway: string, query: string): Promise<any> {
    const res = await fetch(`${gateway}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`graphql ${res.status} from ${gateway}`)
    return res.json()
  }

  /**
   * Discover the processes from the node itself rather than configuring them, so a respawn is
   * tracked automatically. A baked-in PID is exactly what left the prelive dashboard reading a
   * dead process after the 2026-09-03 respawn.
   */
  private async discoverProcesses(): Promise<string[]> {
    const res = await fetch(
      `${this.nodeUrl}/~meta@1.0/info/p4-non-chargable-routes?accept=application/json&accept-bundle`,
      { signal: AbortSignal.timeout(30_000) },
    )
    const container = await res.json()
    const ids = Object.keys(container)
      .filter(k => /^\d+$/.test(k))
      .map(k => container[k]?.template)
      .filter((t: any) => typeof t === 'string')
      .map((t: string) => t.replace(/^\^\//, '').replace(/~process@1\.0\/\((?:[a-z|]+)\)$/, ''))
      .filter((t: string) => /^[A-Za-z0-9_-]{43}$/.test(t))
    return [...new Set(ids)]
  }

  private async currentSlot(pid: string): Promise<number> {
    const res = await fetch(`${this.nodeUrl}/${pid}~process@1.0/slot/current`, {
      signal: AbortSignal.timeout(60_000),
    })
    const n = parseInt((await res.text()).trim(), 10)
    if (!Number.isFinite(n)) throw new Error(`slot/current unreadable for ${pid}`)
    return n
  }

  /**
   * Newest published assignment for a process.
   *
   * ⚠️ Takes the MAX slot across a page rather than trusting `sort:HEIGHT_DESC first:1`. Recent
   * bundled items do not order reliably by height - measured 2026-09-04, that query named slot N-1
   * as newest for four processes whose slot N was already indexed.
   */
  private async newestAssignment(index: string, pid: string): Promise<{ slot: number; timestamp: number } | null> {
    const j = await this.gql(
      index,
      `{ transactions(tags:[{name:"process",values:["${pid}"]},{name:"type",values:["Assignment"]}],
         first:100, sort:HEIGHT_DESC){edges{node{block{timestamp}tags{name value}}}} }`,
    )
    const edges = j?.data?.transactions?.edges ?? []
    let best: { slot: number; timestamp: number } | null = null
    for (const e of edges) {
      const slot = parseInt(e.node.tags.find((t: any) => t.name === 'slot')?.value ?? '', 10)
      if (!Number.isFinite(slot)) continue
      // A pending item has no block yet. Treat it as now - it was just published, which is the
      // opposite of lag.
      const timestamp = e.node.block?.timestamp ? e.node.block.timestamp * 1000 : Date.now()
      if (!best || slot > best.slot) best = { slot, timestamp }
    }
    return best
  }

  private async newestSnapshots(
    index: string,
    pid: string,
  ): Promise<{ any: Snapshot | null; mined: Snapshot | null }> {
    const j = await this.gql(
      index,
      `{ transactions(tags:[{name:"schema",values:["state-snapshot@1"]},{name:"process",values:["${pid}"]}],
         first:100, sort:HEIGHT_DESC){edges{node{id block{timestamp} tags{name value}}}} }`,
    )
    const edges = j?.data?.transactions?.edges ?? []
    let any: Snapshot | null = null
    let mined: Snapshot | null = null
    for (const e of edges) {
      const tags: Record<string, string> = {}
      for (const t of e.node.tags) tags[t.name] = t.value
      const slot = parseInt(tags.slot ?? '', 10)
      if (!Number.isFinite(slot)) continue
      const ts = e.node.block?.timestamp
      const snap: Snapshot = {
        id: e.node.id,
        slot,
        sha: tags['state-sha256'],
        timestamp: ts ? ts * 1000 : 0,
        mined: !!ts,
      }
      if (!any || slot > any.slot) any = snap
      if (snap.mined && (!mined || slot > mined.slot)) mined = snap
    }
    return { any, mined }
  }

  /**
   * Is the snapshot findable by TAG on this index? That is the query recovery actually runs.
   *
   * Returns `null` for COULD NOT TELL - the index did not answer. That is not the same as the
   * snapshot being missing, and reporting it as if it were turns every index hiccup into a
   * data-loss page. The caller must not raise the durability alarm on `null`.
   */
  private async discoverable(index: string, pid: string, id: string): Promise<boolean | null> {
    try {
      const j = await this.gql(
        index,
        `{ transactions(tags:[{name:"schema",values:["state-snapshot@1"]},{name:"process",values:["${pid}"]}],
           first:100){edges{node{id}}} }`,
      )
      return (j?.data?.transactions?.edges ?? []).some((e: any) => e.node.id === id)
    } catch (error) {
      // Deliberately carries NO `alarm=` tag: an index outage is an index outage.
      this.logger.warn(
        `Could not query index ${index} for process [${pid}]: ${error?.message ?? error}. ` +
          `Snapshot discoverability is UNDETERMINED this run, not failed.`,
      )
      return null
    }
  }

  /**
   * Rough age of a process, from the EARLIEST assignment of its own that an index knows about.
   *
   * Not the spawn transaction: a process id is a bundled data item id and is not reliably indexed
   * as a transaction - measured 2026-09-16, live operator-registry's id resolves to nothing while
   * both recently respawned processes' ids resolve fine. Assignments are published by the same
   * path as everything else and the first one is a sound lower bound on age.
   *
   * `null` means the process has NOTHING indexed at all. There is no coverage gap in treating that
   * as undatable here: `checkLag` already alarms loudly on exactly that condition.
   */
  private async earliestAssignmentMs(index: string, pid: string): Promise<number | null> {
    try {
      const j = await this.gql(
        index,
        `{ transactions(tags:[{name:"process",values:["${pid}"]},{name:"type",values:["Assignment"]}],
           first:1, sort:HEIGHT_ASC){edges{node{block{timestamp}}}} }`,
      )
      const edges = j?.data?.transactions?.edges ?? []
      if (!edges.length) return null
      // Indexed but not yet mined means it was published moments ago - that IS brand new.
      const ts = edges[0]?.node?.block?.timestamp
      return ts ? ts * 1000 : Date.now()
    } catch {
      return null
    }
  }

  /**
   * Fetch a published snapshot and prove it is the bytes we published.
   *
   * ⚠️ Do NOT use `/tx/<id>/status` or `/offset` - both look healthy for a bundle whose data never
   * landed. Fetching the ITEM is the only check that proves a gateway unbundled and seeded it.
   *
   * ⚠️ Hash what you receive. arweave.net serves these DECOMPRESSED (measured: a 0.741 MiB gzipped
   * upload came back as 2,119,906 B of `application/json`), so an unconditional gunzip reports a
   * false corruption on a perfectly good snapshot.
   */
  private async retrievable(gateway: string, snap: Snapshot): Promise<Retrieval> {
    try {
      const res = await fetch(`${gateway}/${snap.id}`, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) {
        // 404/410 is the gateway STATING the item is not there - a real durability finding.
        // Everything else (429 rate limit, 5xx, a proxy error) is the gateway failing to answer
        // and says nothing at all about whether the data is on Arweave.
        return res.status === 404 || res.status === 410
          ? { state: 'absent', detail: `http ${res.status}` }
          : { state: 'unavailable', detail: `http ${res.status}` }
      }
      const raw = new Uint8Array(await res.arrayBuffer())
      let body: Uint8Array = raw
      try {
        body = new Uint8Array(gunzipSync(raw))
      } catch {
        /* already decompressed by the gateway */
      }
      const sha = createHash('sha256').update(body).digest('hex')
      if (!snap.sha) return { state: 'ok', detail: `${body.length} B, no state-sha256 tag to compare` }
      return sha === snap.sha
        ? { state: 'ok', detail: `${body.length} B, digest matches` }
        : { state: 'corrupt', detail: `DIGEST MISMATCH got ${sha} want ${snap.sha}` }
    } catch (error) {
      // Timeout, DNS failure, connection reset. A transport failure is not evidence of data loss.
      return { state: 'unavailable', detail: `${error?.message ?? error}` }
    }
  }

  async run(): Promise<void> {
    if (!this.nodeUrl) {
      this.logger.error(
        'HYPERBEAM_NODE_URL is not set. Publishing reliability is NOT being monitored - this is the ' +
          'check that catches silent non-publishing.',
      )
      return
    }

    let pids: string[]
    try {
      pids = await this.discoverProcesses()
    } catch (error) {
      this.logger.error(`Could not discover processes from [${this.nodeUrl}]: ${error?.message ?? error}`)
      return
    }
    if (!pids.length) {
      this.logger.error(`Discovered NO processes from [${this.nodeUrl}]. Publishing is NOT being monitored.`)
      return
    }

    // Both of these read GraphQL, so they take an INDEX, not a data gateway.
    const index = this.indexes[0]
    for (const pid of pids) {
      await this.checkLag(index, pid)
      await this.checkCheckpoint(index, pid)
    }
  }

  /**
   * Lag is measured in TIME, not in slots behind.
   *
   * Slot-count lag needs state across runs to distinguish "briefly behind" from "stuck", and this
   * service runs leader-elected across two workers, so an in-process counter is not reliable.
   * Age of the newest published assignment is stateless and says the same thing.
   *
   * `current > published` is required before the age matters, which makes the check correct for
   * operator-registry too: it is EVENT-DRIVEN, so a long-idle opreg has current == published and
   * never alerts, but an opreg that advanced and did not publish still does.
   */
  private async checkLag(index: string, pid: string): Promise<void> {
    try {
      const [current, newest] = await Promise.all([this.currentSlot(pid), this.newestAssignment(index, pid)])

      if (!newest) {
        this.logger.warn(
          `[alarm=publishing-lag] Process [${pid}] is at slot ${current} and has NO published ` +
            `assignment on ${index}. Nothing this process has ever scheduled is on Arweave.`,
        )
        return
      }

      // Caught up. Drop any recorded stall so the next one starts a fresh clock.
      if (current <= newest.slot) {
        await this.lagState.deleteMany({ process: pid })
        return
      }

      // Behind. Record WHEN we first saw this particular slot unpublished, and measure from that.
      //
      // ⚠️ Do NOT measure from `newest.timestamp`. That is the block time of the PREVIOUS
      // assignment, which on an hourly cadence is already 25-60 min old when healthy, and 500+ min
      // for event-driven operator-registry. Measuring from it fires the alarm the moment the node
      // advances a slot and resolves when the new assignment indexes - it flapped every round.
      // 🚨 Key on the PUBLISHED frontier, NOT on `current`.
      // If publishing stalls while the node keeps settling rounds, `current` advances every hour.
      // Keyed on `current`, every lookup would miss, the clock would reset to now each time, and
      // the alarm would NEVER fire - silently, which is the exact failure class this exists to
      // catch. `newest.slot` is the value that stays STUCK while publishing is broken, so the
      // clock keyed on it runs continuously, and it rolls over on its own once publishing resumes.
      const now = Date.now()
      const stuckAt = newest.slot
      const existing = await this.lagState.findOne({ process: pid, slot: stuckAt })
      let firstSeenAt = existing?.firstSeenAt
      if (!firstSeenAt) {
        firstSeenAt = now
        await this.lagState.updateOne(
          { process: pid, slot: stuckAt },
          { $setOnInsert: { process: pid, slot: stuckAt, firstSeenAt: now } },
          { upsert: true },
        )
        // Older frontiers are moot once we are past them; drop them so this cannot grow unbounded.
        await this.lagState.deleteMany({ process: pid, slot: { $lt: stuckAt } })
      }

      const stalledMs = now - firstSeenAt
      if (stalledMs > this.lagAlertMs) {
        this.logger.warn(
          `[alarm=publishing-lag] Process [${pid}] has been at slot ${current} with nothing newer ` +
            `than slot ${newest.slot} published for ${Math.round(stalledMs / 60000)} min ` +
            `(threshold ${Math.round(this.lagAlertMs / 60000)} min). Assignments may be being ` +
            `DISCARDED - those slots become unpublishable permanently.`,
        )
      } else {
        this.logger.debug(
          `Process [${pid}] slot ${current}, published ${newest.slot}, unpublished for ` +
            `${Math.round(stalledMs / 60000)} min - within threshold`,
        )
      }
    } catch (error) {
      this.logger.error(`Failed the publishing lag check for [${pid}]: ${error?.message ?? error}`)
    }
  }

  /**
   * Checkpoint health: is there a recent snapshot, and is it actually usable for recovery?
   *
   * 🚨 The alarm must separate CANNOT REACH from IS NOT THERE. Every branch below that raises
   * `[alarm=snapshot-unretrievable]` is one where a gateway or index gave us a real answer and
   * the answer was bad. A gateway that times out, 429s or 5xxs is logged WITHOUT an `alarm=` tag,
   * so an arweave.net outage cannot page as data loss.
   */
  private async checkCheckpoint(index: string, pid: string): Promise<void> {
    try {
      // 🚨 AGE AND RETRIEVABILITY ARE BOTH MEASURED ON THE NEWEST **MINED** SNAPSHOT.
      // An unmined item is not yet a durable checkpoint, and dating one as "published now" is a
      // silent-failure hole: a bundle that indexes but never mines would read as 0 h old on every
      // poll forever, so the age threshold could never trip and the propagation grace below would
      // skip the gateway checks every time. Pending items are in flight; they are reported, never
      // used as evidence of a checkpoint.
      const { any: inFlight, mined: snap } = await this.newestSnapshots(index, pid)

      if (!snap) {
        // No checkpoint at all. Before calling that a fault, ask how long the process has existed:
        // a respawn has no snapshot simply because the @daily job has not run since.
        const bornMs = await this.earliestAssignmentMs(index, pid)
        if (bornMs === null) {
          this.logger.warn(
            `Process [${pid}] has no published snapshot and nothing indexed to date it by. ` +
              `The publishing-lag check covers a process with nothing on Arweave.`,
          )
          return
        }
        const bornAgo = Date.now() - bornMs
        const flight = inFlight ? ` A snapshot for slot ${inFlight.slot} is published but NOT YET MINED.` : ''
        if (bornAgo < this.newProcessGraceMs) {
          this.logger.log(
            `Process [${pid}] has no mined snapshot yet but is only ${Math.round(bornAgo / 3600000)} h ` +
              `old (grace ${Math.round(this.newProcessGraceMs / 3600000)} h). The next daily publish covers it.` +
              flight,
          )
          return
        }
        this.logger.warn(
          `[alarm=checkpoint-age] Process [${pid}] has NO mined state snapshot on ${index} and has ` +
            `existed for ${Math.round(bornAgo / 3600000)} h. There is no checkpoint bounding replay for it.` +
            flight,
        )
        return
      }

      const ageMs = Date.now() - snap.timestamp
      if (ageMs > this.checkpointMaxAgeMs) {
        this.logger.warn(
          `[alarm=checkpoint-age] Newest snapshot for process [${pid}] is slot ${snap.slot}, published ` +
            `${Math.round(ageMs / 3600000)} h ago (threshold ${Math.round(this.checkpointMaxAgeMs / 3600000)} h). ` +
            `The daily publish job may have stopped running.`,
        )
      }

      // A snapshot mined minutes ago is EXPECTED not to be seeded and indexed everywhere yet.
      // Bounded by a real block timestamp, so unlike a pending item this window always closes.
      if (ageMs < this.snapshotGraceMs) {
        this.logger.debug(
          `Snapshot ${snap.id} for [${pid}] is ${Math.round(ageMs / 60000)} min old - inside the ` +
            `${Math.round(this.snapshotGraceMs / 60000)} min propagation grace, not judged this run.`,
        )
        return
      }

      // Data gateways: can the bytes be fetched, and are they the bytes we published?
      for (const gw of this.gateways) {
        const { state, detail } = await this.retrievable(gw, snap)
        if (state === 'ok') {
          this.logger.debug(`Snapshot ${snap.id} retrievable from ${gw} (${detail})`)
        } else if (state === 'unavailable') {
          this.logger.warn(
            `Gateway ${gw} did not answer for snapshot ${snap.id} (process [${pid}]): ${detail}. ` +
              `Retrievability is UNDETERMINED this run, not failed.`,
          )
        } else {
          this.logger.warn(
            `[alarm=snapshot-unretrievable] Snapshot ${snap.id} for process [${pid}] slot ${snap.slot} ` +
              `is ${state === 'corrupt' ? 'CORRUPT' : 'ABSENT'} on ${gw}: ${detail}. Recovery from this ` +
              `checkpoint would fail.`,
          )
        }
      }

      // Indexes: is it findable by TAG, which is the query recovery actually runs? An item only one
      // index knows about is a single point of failure for discovery.
      for (const idx of this.indexes) {
        const found = await this.discoverable(idx, pid, snap.id)
        if (found === null) continue // index did not answer; already logged, and not a finding
        if (found) {
          this.logger.debug(`Snapshot ${snap.id} discoverable by tag on ${idx}`)
        } else {
          this.logger.warn(
            `[alarm=snapshot-unretrievable] Snapshot ${snap.id} for process [${pid}] is NOT ` +
              `discoverable by tag on ${idx}. Recovery searches by tag, so it could not find this.`,
          )
        }
      }
    } catch (error) {
      this.logger.error(`Failed the checkpoint check for [${pid}]: ${error?.message ?? error}`)
    }
  }
}
