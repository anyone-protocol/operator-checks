# Publishing checks

The `check-publishing` job verifies that a HyperBEAM node's processes are reaching Arweave and
that their state snapshots can be used for recovery.

A node can stop publishing while it keeps computing. Slots advance and reads stay healthy, so
the node itself shows no fault. These checks compare the node against what public Arweave
infrastructure holds.

## What runs

The job runs on the tasks queue at the same cadence as the balance checks,
`RECHECK_DELAY_MS`. For every process it runs two checks:

| Check | Question | Alarm |
| --- | --- | --- |
| Lag | Has the newest slot been published? | `publishing-lag` |
| Checkpoint | Is there a recent snapshot, and can it be fetched and found? | `checkpoint-age`, `snapshot-unretrievable` |

Processes are discovered from the node at `HYPERBEAM_NODE_URL`, from its list of non-chargeable
routes. They are not configured, so a respawned process is picked up without a change here.

## Gateways and indexes

| Setting | Used for | Default |
| --- | --- | --- |
| `PUBLIC_ARWEAVE_GATEWAYS` | Fetching snapshot data at `/<id>` | `https://arweave.net` |
| `PUBLIC_ARWEAVE_INDEXES` | GraphQL queries at `/graphql` | `https://arweave.net,https://arweave-search.goldsky.com` |

Both are comma-separated lists. The first index is the primary. The rest are secondary.

- These are separate from `ARWEAVE_GATEWAY_*`, which the refill path uses. Retrievability is
  measured through public infrastructure, not through a gateway the protocol operates.
- A data gateway and an index are different roles. A service that answers GraphQL but does not
  serve `/<id>` belongs in the index list only.

## Lag

Lag is measured in time, not in slots.

1. Read the node's current slot and the newest published assignment on the primary index.
2. If the current slot is published, clear any recorded stall for the process.
3. Otherwise record when the published slot was first seen stuck, and measure from that.
4. Raise `publishing-lag` once the stall exceeds `PUBLISHING_LAG_ALERT_MS`.

Details:

- The stall clock is stored in MongoDB, in `PublishingLagState`, keyed by process and slot. The
  service runs leader-elected across several workers, so an in-process timer is not reliable.
- The clock is keyed on the newest published slot, which stays fixed while publishing is
  stalled. The current slot keeps advancing during a stall and cannot serve as the key.
- The block time of the newest published assignment is not used as the reference. It is the
  time of the previous assignment, which is already old on a healthy process.
- The node exposes no per-slot timestamp, so first-seen time is the only available reference.
- The newest assignment is the highest slot on a page of 100 results. Recent bundled items do
  not sort reliably by height.
- An assignment with no block yet is pending. It counts as published.
- An event-driven process that sits idle has its current slot published and never alerts.
- A process with no published assignment at all raises `publishing-lag` immediately.

A lag of a few minutes is normal. The bundler batches uploads, the bundle then has to be mined,
and the index has to pick it up. The default threshold is 30 minutes.

## Checkpoint

### Age

- Age is measured on the newest mined snapshot. A pending snapshot is reported and is not
  counted as a checkpoint.
- `checkpoint-age` is raised when the newest mined snapshot is older than
  `CHECKPOINT_MAX_AGE_MS`.
- A process with no mined snapshot is dated by its earliest indexed assignment. It is not dated
  by its spawn transaction, which is a bundled item and is not reliably indexed.
- A process younger than `NEW_PROCESS_GRACE_MS` with no snapshot is logged without an alarm.
- A process with nothing indexed cannot be dated. The lag check covers that case.

### Retrievability

Retrievability is judged on the newest snapshot older than `SNAPSHOT_GRACE_MS`. A mined bundle
still has to be unbundled and served by each gateway, which can take hours. Judging the newest
snapshot that has had time to propagate means every run checks something, and a longer grace
only delays when a given snapshot is verified.

For each data gateway the snapshot is fetched and hashed, and the digest is compared with the
snapshot's `state-sha256` tag.

| Result | Meaning | Alarm |
| --- | --- | --- |
| `ok` | The bytes came back and the digest matches | none |
| `absent` | The gateway answered 404 or 410 | `snapshot-unretrievable` |
| `corrupt` | The bytes came back and the digest differs | `snapshot-unretrievable` |
| `unavailable` | Rate limit, 5xx, timeout, or transport failure | none, logged as undetermined |

Details:

- A gateway that fails to answer says nothing about the data, so it never raises an alarm.
- The item itself is fetched. `/tx/<id>/status` and `/offset` can look healthy for a bundle
  whose data never landed.
- A gateway may serve the snapshot already decompressed. The body is gunzipped when possible
  and hashed as received otherwise.

### Discoverability

Recovery finds a checkpoint by tag and takes the newest one an index returns. Each secondary
index is therefore judged on whether it holds a recent settled snapshot, not on whether it
holds one particular item.

- `snapshot-unretrievable` is raised when the newest settled snapshot on a secondary index is
  older than `INDEX_MAX_AGE_MS`.
- An index that holds no settled snapshot is dated from the oldest mined snapshot on the
  primary index.
- An index that lacks the one target snapshot but holds a recent one is logged without an alarm.
  An index can skip a single bundle, and the snapshots on either side still serve recovery.
- An index that cannot be queried is logged as undetermined, without an alarm.
- The primary index is not re-checked. The target came from its own query, and its staleness is
  covered by `checkpoint-age`.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `HYPERBEAM_NODE_URL` | none | Node to monitor. Unset disables the checks and logs an error |
| `PUBLISHING_LAG_ALERT_MS` | `1800000` (30 min) | Stall time before `publishing-lag` |
| `CHECKPOINT_MAX_AGE_MS` | `172800000` (48 h) | Snapshot age before `checkpoint-age`. Two missed daily publishes |
| `SNAPSHOT_GRACE_MS` | `43200000` (12 h) | Age a snapshot must reach before retrievability is judged |
| `NEW_PROCESS_GRACE_MS` | `93600000` (26 h) | Age under which a process may have no snapshot |
| `INDEX_MAX_AGE_MS` | `259200000` (72 h) | Staleness allowed on a secondary index |
| `PUBLIC_ARWEAVE_GATEWAYS` | `https://arweave.net` | Data gateways |
| `PUBLIC_ARWEAVE_INDEXES` | `https://arweave.net,https://arweave-search.goldsky.com` | GraphQL indexes |

Snapshots are published daily, and the defaults are sized around that cadence.
