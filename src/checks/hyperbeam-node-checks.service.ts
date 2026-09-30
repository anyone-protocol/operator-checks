import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Arweave from 'arweave'
import BigNumber from 'bignumber.js'

/**
 * Balance of the HyperBEAM node's own Arweave wallet.
 *
 * Since the nodes became their own bundlers, this wallet pays for EVERY assignment and
 * message the node uploads, not just snapshots. When it empties, the node keeps computing
 * slots normally and `dev_scheduler_server` DISCARDS the upload result, so nothing surfaces
 * the failure: `as/` and `now/` stay healthy while the durability chain is off and each
 * affected slot becomes unpublishable permanently.
 *
 * That is not hypothetical. On 2026-09-03 stage had published nothing for 56 hours and live
 * for 14.5, both wallets holding less than the cost of a single 5 KB upload, and it was found
 * by someone happening to look. Measured burn at the time was 0.238 AR/day on live and
 * 0.328 on stage, so the 2 AR each had been funded with lasted 8 and 6 days respectively.
 *
 * Configured by ADDRESS, not by JWK: a balance read and an incoming transfer both need only
 * the public address, so the node's signing key never has to leave the node.
 */
@Injectable()
export class HyperbeamNodeChecksService {
  private readonly logger = new Logger(HyperbeamNodeChecksService.name)

  private nodeAddress: string
  private minBalance: number
  private maxBalance: number

  // Below this the node cannot afford even one small upload, so publishing has already
  // stopped rather than merely being low. Logged loudly but deliberately WITHOUT its own
  // alarm tag: the vocabulary is matched string-by-string in Grafana, and this
  // condition is already covered by the existing path - a depleted node triggers a refill,
  // and if that refill cannot happen `refill-failed-ar` fires from RefillsService.
  private static readonly STOPPED_AR = 0.01

  private arweave: Arweave

  constructor(
    private readonly config: ConfigService<{
      HYPERBEAM_NODE_AR_ADDRESS: string
      HYPERBEAM_NODE_MIN_AR: number
      HYPERBEAM_NODE_MAX_AR: number
      ARWEAVE_GATEWAY_PROTOCOL: string
      ARWEAVE_GATEWAY_HOST: string
      ARWEAVE_GATEWAY_PORT: number
    }>,
  ) {
    const address = this.config.get<string>('HYPERBEAM_NODE_AR_ADDRESS', { infer: true })
    if (!address) {
      this.logger.error('Missing HYPERBEAM_NODE_AR_ADDRESS. Skipping hyperbeam node checks...')
    } else if (!/^[A-Za-z0-9_-]{43}$/.test(address)) {
      // Caught a real failure: an unquoted HCL value arrived as the literal
      // "${EbD49sHT...}", every balance read 400d, and nothing alerted. Fail loudly at
      // startup rather than once per cycle in a way that turned out to be invisible.
      this.logger.error(
        `HYPERBEAM_NODE_AR_ADDRESS is not a 43-character Arweave address: [${address}]. ` +
          `Skipping hyperbeam node checks - the wallet will NOT be monitored or refilled.`,
      )
    } else {
      this.nodeAddress = address
      this.minBalance = this.config.get<number>('HYPERBEAM_NODE_MIN_AR', { infer: true })
      this.maxBalance = this.config.get<number>('HYPERBEAM_NODE_MAX_AR', { infer: true })
      this.arweave = Arweave.init({
        host: this.config.get<string>('ARWEAVE_GATEWAY_HOST', { infer: true }) || 'arweave.net',
        port: this.config.get<number>('ARWEAVE_GATEWAY_PORT', { infer: true }) || 443,
        protocol: this.config.get<string>('ARWEAVE_GATEWAY_PROTOCOL', { infer: true }) || 'https',
      })
      this.logger.log(`Initialized hyperbeam node checks for address: [${this.nodeAddress}]`)
    }
  }

  async getNodeBalance(): Promise<{
    balance: BigNumber
    requestAmount?: BigNumber
    address?: string
  }> {
    if (this.nodeAddress) {
      try {
        const winstonBalance = await this.arweave.wallets.getBalance(this.nodeAddress)
        const arBalance = BigNumber(this.arweave.ar.winstonToAr(winstonBalance))

        // getBalance does NOT throw on a 4xx - it returns the error body, which winstonToAr
        // turns into the string "NaN". Every BigNumber comparison against NaN is false, so
        // without this guard a bad address or gateway error skips all three branches, logs
        // nothing, requests no refill, and looks exactly like a healthy wallet.
        if (!arBalance.isFinite()) {
          this.logger.error(
            `Could not read a balance for hyperbeam node [${this.nodeAddress}]: gateway returned ` +
              `${JSON.stringify(winstonBalance)}. The wallet is NOT being monitored.`,
          )
          return { balance: BigNumber(0), address: this.nodeAddress }
        }

        if (arBalance.lt(BigNumber(HyperbeamNodeChecksService.STOPPED_AR))) {
          this.logger.error(
            `HyperBEAM node [${this.nodeAddress}] holds ` +
              `${arBalance} $AR and cannot pay for an upload. Assignments are being DISCARDED and those ` +
              `slots are unpublishable permanently.`,
          )
        }

        if (arBalance.lt(BigNumber(this.minBalance))) {
          this.logger.warn(
            `Balance depletion on hyperbeam node [${this.nodeAddress}]: ` +
              `${arBalance} $AR < ${this.minBalance} $AR min`,
          )

          return {
            balance: arBalance,
            requestAmount: BigNumber(this.maxBalance).minus(arBalance),
            address: this.nodeAddress,
          }
        } else if (arBalance.gt(BigNumber(this.maxBalance))) {
          this.logger.warn(
            `[alarm=balance-accumulation-ar-bundler] Balance accumulation on hyperbeam node ` +
              `[${this.nodeAddress}]: ${arBalance} $AR > ${this.maxBalance} $AR max`,
          )
        }

        return { balance: arBalance, address: this.nodeAddress }
      } catch (error) {
        this.logger.error(`Exception while fetching hyperbeam node balance`, error.stack)
      }
    } else this.logger.error('Hyperbeam node address undefined. Unable to fetch node balance')

    return { balance: BigNumber(0), address: this.nodeAddress }
  }
}
