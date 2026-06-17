# Operator Checks

A monitoring and auto-refill service for the [Anyone Protocol](https://anyone.io). It
periodically checks the balances of the protocol's operator and controller wallets across
multiple chains (EVM, Arweave, AO) and asset types (native gas tokens, the $ANYONE ERC-20,
and ArDrive Turbo Credits), records every reading in MongoDB, and automatically tops wallets
back up when they fall below a configured threshold.

The protocol's automated jobs — bundling data to Arweave, paying out relay/staking rewards,
maintaining the operator registry — all spend from hot wallets. If one of those wallets runs
dry, the corresponding on-chain job stalls. Operator Checks exists to keep those wallets
funded without manual intervention, and to raise alarms when something looks wrong.

## Contents

- [How it works](#how-it-works)
- [What gets checked](#what-gets-checked)
- [Refills](#refills)
- [Running locally](#running-locally)
- [Configuration reference](#configuration-reference)
- [Deployment](#deployment)
- [Alarms & observability](#alarms--observability)
- [Roadmap / not-yet-wired](#roadmap--not-yet-wired)

---

## How it works

Operator Checks is a [NestJS](https://nestjs.com/) application backed by
[BullMQ](https://docs.bullmq.io/) (Redis) for job scheduling and MongoDB for persistence.

The flow is a self-rescheduling loop:

```
tasks queue                balance-checks flow                 refills queue
-----------                -------------------                 -------------
check-balances  ─────────► children:                          refill-ar
   │                         check-bundler          ──┐         refill-token
   │ (re-queues itself       check-hodler             │ shortfall?
   │  every RECHECK_DELAY_MS check-rewards-pool       ├───────► refill-turbo-credits
   │  ms)                    check-relay-registry     │
   └─────────────────────►   check-relay-rewards      │
                             check-staking-rewards    │
                             check-turbo-* (x4)      ─┘
                             ▼
                           review-balance-checks  ──► store all readings in MongoDB
```

1. **`check-balances`** (tasks queue) fans out a BullMQ *flow*: one child job per balance
   check, plus a parent `review-balance-checks` job that runs once all children finish.
   It then re-queues itself with a delay of `RECHECK_DELAY_MS` (default 5 minutes; 15
   minutes in production), so the service runs continuously.
2. Each **check job** reads a wallet's balance and compares it against `MIN`/`MAX`
   thresholds. If the balance is below `MIN`, the job computes the shortfall
   (`MAX − balance`) and enqueues a refill. If it's above `MAX`, it logs a
   balance-accumulation alarm (funds may be stuck or misconfigured).
3. **`review-balance-checks`** collects every child's reading and persists them to the
   `BalancesData` collection in MongoDB as a time-stamped batch.
4. **Refill jobs** (refills queue) send the actual top-up transaction from the relevant
   spender wallet — but only when `IS_LIVE=true`; otherwise they log what they *would*
   have sent and do nothing.

### Clustering & leader election

The service is designed to run with multiple instances (Nomad runs `count = 2`) without
double-spending. Only one instance is the **leader**, and only the leader seeds the initial
`check-balances` job on bootstrap.

- **Leader election** uses [Consul](https://www.consul.io/) sessions and a KV lock
  (`clusters/<service>/leader`). See [cluster.service.ts](src/cluster/cluster.service.ts).
- **Local forking** uses Node's `cluster` module; `CPU_COUNT` controls how many worker
  threads fork, and the first fork is flagged the local leader via `IS_LOCAL_LEADER`. See
  [app-threads.service.ts](src/cluster/app-threads.service.ts).
- `isTheOne()` returns true only for the process that is both the Consul leader *and* the
  local leader — that process owns the one-time bootstrap actions.

When `IS_LIVE` is not `true`, Consul is skipped entirely and the service boots in
single-node mode (always leader), making local development straightforward.

### Health

An HTTP server exposes `GET /` and `GET /health`, both returning `OK` (used by the Nomad
health check). See [app.controller.ts](src/app.controller.ts).

---

## What gets checked

Each row below is one child job in the balance-checks flow. Thresholds are set via the env
vars listed in the [configuration reference](#configuration-reference).

| Check job | Wallet | Chain | Asset | Auto-refill |
|-----------|--------|-------|-------|-------------|
| `check-bundler` | Bundler operator | Arweave | $AR | ✅ sends $AR |
| `check-rewards-pool` | Rewards pool | EVM | $ANYONE (ERC-20) | ✅ sends $ANYONE |
| `check-hodler` | Hodler operator | EVM | $ETH (gas) | ❌ monitor only by design — gas is user-funded |
| `check-turbo-deployer` | Turbo deployer | ArDrive Turbo | Turbo Credits | ✅ tops up credits |
| `check-turbo-operator-registry` | Operator Registry controller | ArDrive Turbo | Turbo Credits | ✅ tops up credits |
| `check-turbo-relay-rewards` | Relay Rewards controller | ArDrive Turbo | Turbo Credits | ✅ tops up credits |
| `check-turbo-staking-rewards` | Staking Rewards controller | ArDrive Turbo | Turbo Credits | ✅ tops up credits |
| `check-relay-registry` | Operator Registry controller | AO | $AO | ⚠️ monitor only — [see below](#ao-balance-checks) |
| `check-relay-rewards` | Relay Rewards controller | AO | $AO | ⚠️ monitor only |
| `check-staking-rewards` | Staking Rewards controller | AO | $AO | ⚠️ monitor only |

The aggregating job `review-balance-checks` is not a check itself; it stores all of the
above readings.

### Balance readings (MongoDB)

Every check writes a [`BalancesData`](src/checks/schemas/balances-data.ts) document:

| Field | Description |
|-------|-------------|
| `stamp` | Epoch-ms timestamp shared by all readings in a single flow run |
| `kind` | Reading type, e.g. `bundler-operator-ar-balance`, `turbo-deployer-credits` |
| `amount` | Balance at check time (human-readable units, as a string) |
| `requestAmount` | Shortfall that triggered a refill, if any |
| `address` | The wallet/address that was checked |

### Hodler operator gas

The `check-hodler` job watches the hodler operator's $ETH balance, but **does not refill it**.
That wallet's gas is user-funded — users send $ETH to it so it has gas to claim their rewards —
so the protocol intentionally does not top it up. We simply keep an eye on it and raise an
alarm if it drifts outside its `MIN`/`MAX` band. The shortfall is still computed and recorded,
but no refill is enqueued.

### AO balance checks

The three AO checks (`check-relay-registry`, `check-relay-rewards`,
`check-staking-rewards`) read the controllers' $AO token balances via an `aoconnect`
dry-run against `AO_TOKEN_PROCESS_ID`.

They are gated by `AO_BALANCE_CHECKS_ENABLED` and are **currently disabled in deployment**
(`AO_BALANCE_CHECKS_ENABLED="false"`): AO processes do not require $AO for gas/transaction
fees yet, so there is nothing to keep topped up. The checks remain in place so they can be
switched on the moment AO begins charging fees. When disabled, these jobs short-circuit and
report a zero balance.

---

## Refills

Refills run from dedicated **spender** wallets and are only executed when `IS_LIVE=true`.
In any other mode the refill is logged as a no-op (`NOT LIVE, ... did NOT send ...`), which
makes it safe to run the full pipeline against real RPCs without moving funds.

| Refill job | Asset | Spender | Notes |
|------------|-------|---------|-------|
| `refill-ar` | $AR | `AR_SPENDER_KEY` (Arweave JWK) | Verifies the spender has enough $AR before sending |
| `refill-token` | $ANYONE | `ETH_SPENDER_KEY` (EVM key) | ERC-20 `transfer` on `TOKEN_CONTRACT_ADDRESS` |
| `refill-turbo-credits` | Turbo Credits | `AR_SPENDER_KEY` | Tops up another address's credits by spending $AR via the Turbo SDK |
| `refill-eth` | $ETH | `ETH_SPENDER_KEY` | Implemented but intentionally not enqueued — the hodler's gas is user-funded, so we only monitor it |
| `refill-ao` | $AO | — | Stub only — [see roadmap](#roadmap--not-yet-wired) |

See [refills.service.ts](src/refills/refills.service.ts) and
[refills-queue.ts](src/tasks/processors/refills-queue.ts).

### Turbo refill de-duplication

Turbo top-ups can take time to confirm, and the check loop runs faster than confirmation.
To avoid stacking duplicate refills, before each Turbo top-up the service queries Arweave
GraphQL for recent refill transactions (tagged with the destination address) from the AR
spender and checks their status via the Turbo SDK. If a transaction is still `pending`
within `PENDING_TURBO_REFILL_TTL_MS` (default 2h), the new refill is skipped. On any error
it errs on the side of skipping, to avoid double-funding. See `hasPendingTurboRefill` in
[refills.service.ts](src/refills/refills.service.ts).

---

## Running locally

### Prerequisites

- Node.js (LTS) and npm
- A Redis instance (standalone is fine for local dev)
- A MongoDB instance

### Install & run

```bash
npm install

# dev with hot reload
npm run start:dev

# or a one-off run
npm start
```

Provide configuration via environment variables (e.g. a `.env` file — `@nestjs/config` is
loaded globally). A minimal local setup:

```bash
# Leave IS_LIVE unset/false so no real transactions are sent and Consul is skipped
MONGO_URI="mongodb://localhost:27017/operator-checks"
REDIS_MODE="standalone"
REDIS_HOSTNAME="localhost"
REDIS_PORT=6379
JSON_RPC="https://..."             # an EVM RPC endpoint
TOKEN_CONTRACT_ADDRESS="0x..."     # $ANYONE token
# ...plus the wallet addresses / thresholds you want to exercise
```

With `IS_LIVE` unset, the service runs single-node, executes all checks against the real
RPCs/gateways, persists readings, and *logs* (but does not perform) any refills.

> **Note:** `RefillsService` requires `ETH_SPENDER_KEY`, `TOKEN_CONTRACT_ADDRESS`, and
> `AR_SPENDER_KEY` to be present at startup or it throws. Even in non-live mode these must
> be set (dummy values are fine for keys you don't intend to use).

### Other scripts

```bash
npm run build        # nest build
npm test             # jest unit tests
npm run test:cov     # coverage
npm run lint         # eslint --fix
npm run format       # prettier
```

---

## Configuration reference

All configuration is via environment variables.

### Core / runtime

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for the health endpoint |
| `IS_LIVE` | unset | `"true"` enables real refill transactions and Consul clustering. Anything else = dry-run, single-node, and the tasks queue is obliterated on boot |
| `DO_CLEAN` | unset | `"true"` obliterates the tasks queue on bootstrap (leader only) |
| `RECHECK_DELAY_MS` | `300000` (5 min) | Delay between balance-check runs (production uses `900000` = 15 min) |
| `VERSION` | unset | Informational build/commit identifier (set by deployment) |

### Persistence & queues

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | — | MongoDB connection string |
| `REDIS_MODE` | `standalone` | `standalone` or `sentinel` |
| `REDIS_HOSTNAME` / `REDIS_PORT` | — | Redis host/port (standalone mode) |
| `REDIS_MASTER_NAME` | — | Sentinel master name (sentinel mode) |
| `REDIS_SENTINEL_{1,2,3}_HOST` / `_PORT` | — | Sentinel addresses (sentinel mode) |

### Clustering (Consul)

Only used when `IS_LIVE=true`. If host/port are missing, the service falls back to
single-node mode.

| Variable | Description |
|----------|-------------|
| `CONSUL_HOST` / `CONSUL_PORT` | Consul agent address |
| `CONSUL_SERVICE_NAME` | Service name used for the leader-election KV key/session |
| `CONSUL_TOKEN_CONTROLLER_CLUSTER` | Consul ACL token |
| `IS_LOCAL_LEADER` | `"true"` marks a process as the local leader (set per-fork) |
| `CPU_COUNT` | Number of worker threads to fork |

### Arweave gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `ARWEAVE_GATEWAY_PROTOCOL` | `https` | Gateway protocol |
| `ARWEAVE_GATEWAY_HOST` | `arweave.net` | Gateway host |
| `ARWEAVE_GATEWAY_PORT` | `443` | Gateway port |

### EVM (hodler / rewards pool / token refills)

| Variable | Description |
|----------|-------------|
| `JSON_RPC` | EVM JSON-RPC endpoint |
| `TOKEN_CONTRACT_ADDRESS` | $ANYONE ERC-20 contract address |
| `ETH_SPENDER_KEY` | Private key of the EVM spender wallet (for $ANYONE / $ETH refills) |
| `HODLER_OPERATOR_ADDRESS` | Wallet whose $ETH gas balance is monitored |
| `HODLER_OPERATOR_MIN_ETH` / `MAX_ETH` | $ETH thresholds (ether units) |
| `REWARDS_POOL_ADDRESS` | Wallet whose $ANYONE balance is monitored |
| `REWARDS_POOL_MIN_TOKEN` / `MAX_TOKEN` | $ANYONE thresholds (whole tokens) |

### Arweave spender & bundler

| Variable | Description |
|----------|-------------|
| `AR_SPENDER_KEY` | Arweave JWK (JSON) for $AR refills and Turbo top-ups |
| `BUNDLER_OPERATOR_JWK` | Arweave JWK of the bundler operator being monitored |
| `BUNDLER_MIN_AR` / `MAX_AR` | $AR thresholds for the bundler |

### AO checks

| Variable | Default | Description |
|----------|---------|-------------|
| `AO_BALANCE_CHECKS_ENABLED` | enabled unless `"false"` | Toggles all $AO balance checks (disabled in deployment) |
| `AO_TOKEN_PROCESS_ID` | — | AO process ID of the $AO token |
| `OPERATOR_REGISTRY_CONTROLLER_ADDRESS` | — | Operator Registry controller (also used for Turbo check) |
| `OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE` / `MAX` | — | $AO thresholds |
| `RELAY_REWARDS_CONTROLLER_ADDRESS` | — | Relay Rewards controller (also used for Turbo check) |
| `RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE` / `MAX` | — | $AO thresholds |
| `STAKING_REWARDS_CONTROLLER_ADDRESS` | — | Staking Rewards controller (also used for Turbo check) |
| `STAKING_REWARDS_OPERATOR_MIN_AO_BALANCE` / `MAX` | — | $AO thresholds |

### Turbo Credits

| Variable | Default | Description |
|----------|---------|-------------|
| `TURBO_DEPLOYER_ADDRESS` | — | Turbo deployer wallet |
| `TURBO_DEPLOYER_MIN_CREDITS` / `MAX_CREDITS` | — | Credit thresholds |
| `TURBO_OPERATOR_REGISTRY_MIN_CREDITS` / `MAX_CREDITS` | — | Credit thresholds (address from `OPERATOR_REGISTRY_CONTROLLER_ADDRESS`) |
| `TURBO_RELAY_REWARDS_MIN_CREDITS` / `MAX_CREDITS` | — | Credit thresholds (address from `RELAY_REWARDS_CONTROLLER_ADDRESS`) |
| `TURBO_STAKING_REWARDS_MIN_CREDITS` / `MAX_CREDITS` | — | Credit thresholds (address from `STAKING_REWARDS_CONTROLLER_ADDRESS`) |
| `PENDING_TURBO_REFILL_TTL_MS` | `7200000` (2h) | Window for treating a recent Turbo refill as still pending |

---

## Deployment

The service ships as a Docker image (`ghcr.io/anyone-protocol/operator-checks`, built by
[.github/workflows/release-action.yml](.github/workflows/release-action.yml)) and runs on
HashiCorp Nomad. Job specs live in [operations/](operations/):

- [operator-checks-live.hcl](operations/operator-checks-live.hcl) / [operator-checks-stage.hcl](operations/operator-checks-stage.hcl) — the service jobs (2 instances each, `IS_LIVE=true`, Redis in sentinel mode, leader-elected via Consul).
- [operator-checks-redis-sentinel-live.hcl](operations/operator-checks-redis-sentinel-live.hcl) / [operator-checks-redis-sentinel-stage.hcl](operations/operator-checks-redis-sentinel-stage.hcl) — the Redis sentinel deployments.

Secrets (spender keys, RPC URLs, controller addresses) are pulled from Vault; non-secret
config (token address, Mongo URI, Redis/Arweave gateway endpoints) is rendered from Consul
service discovery. See the `template` blocks in the job specs for the exact mapping.

---

## Alarms & observability

Logging uses Winston with a single-line console format (`timestamp|level|context: message`),
suitable for log aggregation. See [main.ts](src/main.ts).

Operationally important conditions are logged with a machine-parseable
`[alarm=<name>]` tag so they can be alerted on. Notable alarms:

- `balance-accumulation-*` — a monitored wallet is *above* its `MAX` threshold (funds may be
  stuck or thresholds misconfigured).
- `refill-failed-eth` / `refill-failed-anyonetokens` / `refill-failed-ar` /
  `refill-failed-turbo-credits` / `refill-failed-ao` — a refill transaction failed or the
  spender lacked sufficient balance.
- `failed-job-<jobName>` — a BullMQ job failed.

---

## Roadmap / not-yet-wired

The following are present in the code as intended behavior but not active today:

- **$AO refills.** `RefillsService.sendAoTo` is a stub (logs "Not implemented yet"). The AO
  balance checks themselves are also disabled in deployment because AO does not yet charge
  $AO for gas/transaction fees; both will become relevant once it does.
