import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'

type Snapshot = { id: string; slot: number; sha: string; timestamp: number }

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

  // A lag is NORMAL for minutes: our bundler batches on a ~5 min idle flush, then mines, then the
  // gateway indexes. Stage looked exactly like the failure mode for ~4 minutes before four
  // assignments landed at once. Default to 3 flush cycles so a healthy flush never pages anyone.
  static readonly DEFAULT_LAG_ALERT_MS = 30 * 60 * 1000
  // Snapshots publish @daily, so two missed runs is the signal.
  static readonly DEFAULT_CHECKPOINT_MAX_AGE_MS = 48 * 60 * 60 * 1000

  constructor(
    private readonly config: ConfigService<{
      HYPERBEAM_NODE_URL: string
      PUBLISHING_LAG_ALERT_MS: string
      CHECKPOINT_MAX_AGE_MS: string
      PUBLIC_ARWEAVE_GATEWAYS: string
      PUBLIC_ARWEAVE_INDEXES: string
    }>,
  ) {
    this.nodeUrl = (this.config.get<string>('HYPERBEAM_NODE_URL', { infer: true }) || '').replace(/\/$/, '')
    this.lagAlertMs =
      parseInt(this.config.get<string>('PUBLISHING_LAG_ALERT_MS', { infer: true }) ?? '', 10) ||
      PublishingChecksService.DEFAULT_LAG_ALERT_MS
    this.checkpointMaxAgeMs =
      parseInt(this.config.get<string>('CHECKPOINT_MAX_AGE_MS', { infer: true }) ?? '', 10) ||
      PublishingChecksService.DEFAULT_CHECKPOINT_MAX_AGE_MS
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

  private async newestSnapshot(index: string, pid: string): Promise<Snapshot | null> {
    const j = await this.gql(
      index,
      `{ transactions(tags:[{name:"schema",values:["state-snapshot@1"]},{name:"process",values:["${pid}"]}],
         first:100, sort:HEIGHT_DESC){edges{node{id block{timestamp} tags{name value}}}} }`,
    )
    const edges = j?.data?.transactions?.edges ?? []
    let best: Snapshot | null = null
    for (const e of edges) {
      const tags: Record<string, string> = {}
      for (const t of e.node.tags) tags[t.name] = t.value
      const slot = parseInt(tags.slot ?? '', 10)
      if (!Number.isFinite(slot)) continue
      const timestamp = e.node.block?.timestamp ? e.node.block.timestamp * 1000 : Date.now()
      if (!best || slot > best.slot) best = { id: e.node.id, slot, sha: tags['state-sha256'], timestamp }
    }
    return best
  }

  /** Is the snapshot findable by TAG on this index? That is the query recovery actually runs. */
  private async discoverable(index: string, pid: string, id: string): Promise<boolean> {
    const j = await this.gql(
      index,
      `{ transactions(tags:[{name:"schema",values:["state-snapshot@1"]},{name:"process",values:["${pid}"]}],
         first:100){edges{node{id}}} }`,
    )
    return (j?.data?.transactions?.edges ?? []).some((e: any) => e.node.id === id)
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
  private async retrievable(gateway: string, snap: Snapshot): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${gateway}/${snap.id}`, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) return { ok: false, detail: `http ${res.status}` }
      const raw = new Uint8Array(await res.arrayBuffer())
      let body: Uint8Array = raw
      try {
        body = new Uint8Array(gunzipSync(raw))
      } catch {
        /* already decompressed by the gateway */
      }
      const sha = createHash('sha256').update(body).digest('hex')
      if (!snap.sha) return { ok: true, detail: `${body.length} B, no state-sha256 tag to compare` }
      return sha === snap.sha
        ? { ok: true, detail: `${body.length} B, digest matches` }
        : { ok: false, detail: `DIGEST MISMATCH got ${sha} want ${snap.sha}` }
    } catch (error) {
      return { ok: false, detail: `${error?.message ?? error}` }
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

      if (current <= newest.slot) return

      const ageMs = Date.now() - newest.timestamp
      if (ageMs > this.lagAlertMs) {
        this.logger.warn(
          `[alarm=publishing-lag] Process [${pid}] is at slot ${current} but the newest published ` +
            `assignment is slot ${newest.slot}, last seen ${Math.round(ageMs / 60000)} min ago ` +
            `(threshold ${Math.round(this.lagAlertMs / 60000)} min). Assignments may be being ` +
            `DISCARDED - those slots become unpublishable permanently.`,
        )
      } else {
        this.logger.debug(
          `Process [${pid}] slot ${current}, published ${newest.slot}, ${Math.round(ageMs / 60000)} min - within threshold`,
        )
      }
    } catch (error) {
      this.logger.error(`Failed the publishing lag check for [${pid}]: ${error?.message ?? error}`)
    }
  }

  /**
   * Checkpoint age + retrievability + independent discoverability.
   *
   * These are one check because they answer one question: could we actually recover this process
   * from its newest published checkpoint right now?
   */
  private async checkCheckpoint(index: string, pid: string): Promise<void> {
    try {
      const snap = await this.newestSnapshot(index, pid)
      if (!snap) {
        this.logger.warn(
          `[alarm=checkpoint-age] Process [${pid}] has NO published state snapshot on ${index}. ` +
            `There is no checkpoint bounding replay for it.`,
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

      // Data gateways: can the bytes be fetched, and are they the bytes we published?
      for (const gw of this.gateways) {
        const { ok, detail } = await this.retrievable(gw, snap)
        if (ok) {
          this.logger.debug(`Snapshot ${snap.id} retrievable from ${gw} (${detail})`)
        } else {
          this.logger.warn(
            `[alarm=snapshot-unretrievable] Snapshot ${snap.id} for process [${pid}] slot ${snap.slot} ` +
              `is NOT retrievable from ${gw}: ${detail}. Recovery from this checkpoint would fail.`,
          )
        }
      }

      // Indexes: is it findable by TAG, which is the query recovery actually runs? An item only one
      // index knows about is a single point of failure for discovery.
      for (const idx of this.indexes) {
        try {
          if (await this.discoverable(idx, pid, snap.id)) {
            this.logger.debug(`Snapshot ${snap.id} discoverable by tag on ${idx}`)
          } else {
            this.logger.warn(
              `[alarm=snapshot-unretrievable] Snapshot ${snap.id} for process [${pid}] is NOT ` +
                `discoverable by tag on ${idx}. Recovery searches by tag, so it could not find this.`,
            )
          }
        } catch (error) {
          this.logger.warn(
            `[alarm=snapshot-unretrievable] Could not query index ${idx} for process [${pid}]: ` +
              `${error?.message ?? error}`,
          )
        }
      }
    } catch (error) {
      this.logger.error(`Failed the checkpoint check for [${pid}]: ${error?.message ?? error}`)
    }
  }
}
