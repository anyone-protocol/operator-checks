import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Arweave from 'arweave'
import { JWKInterface } from 'arweave/node/lib/wallet'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

interface GraphQLTransaction {
  id: string
  block?: {
    timestamp: number
  }
}

interface GraphQLResponse {
  data?: {
    transactions?: {
      edges?: Array<{
        node: GraphQLTransaction
      }>
    }
  }
}


@Injectable()
export class RefillsService {
  private readonly logger = new Logger(RefillsService.name)

  private isLive?: string
  private jsonRpc?: string
  private tokenAddress?: string
  private ethSpender: ethers.Wallet
  private ethSpenderAddress: string
  private provider: ethers.JsonRpcProvider
  private tokenContract: ethers.Contract
  private erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)']
  private arweave: Arweave
  private arSpender: JWKInterface
  private arSpenderAddress: string
  private arweaveGatewayUrl: string
  private arRefillLookbackMs: number

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      JSON_RPC: string
      ETH_SPENDER_KEY: string
      AR_SPENDER_KEY: string
      AR_REFILL_LOOKBACK_MS: number
      ARWEAVE_GATEWAY_PROTOCOL: string
      ARWEAVE_GATEWAY_HOST: string
      ARWEAVE_GATEWAY_PORT: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', { infer: true })
    const ethSpenderKey = this.config.get<string>('ETH_SPENDER_KEY', { infer: true })
    this.provider = new ethers.JsonRpcProvider(this.jsonRpc)
    if (!ethSpenderKey) {
      throw new Error('Missing ETH_SPENDER_KEY')
    }
    if (!this.tokenAddress) {
      throw new Error('Missing TOKEN_CONTRACT_ADDRESS')
    }
    this.ethSpender = new ethers.Wallet(ethSpenderKey, this.provider)
    this.tokenContract = new ethers.Contract(this.tokenAddress, this.erc20Abi, this.ethSpender)
    const arSpenderKey = this.config.get<string>('AR_SPENDER_KEY', { infer: true })
    if (!arSpenderKey) {
      throw new Error('Missing AR_SPENDER_KEY')
    }
    try {
      this.arSpender = JSON.parse(arSpenderKey)
    } catch (error) {
      throw new Error('Failed to parse AR_SPENDER_KEY')
    }

    const arweaveHost = this.config.get<string>('ARWEAVE_GATEWAY_HOST', { infer: true }) || 'arweave.net'
    const arweavePort = this.config.get<number>('ARWEAVE_GATEWAY_PORT', { infer: true }) || 443
    const arweaveProtocol = this.config.get<string>('ARWEAVE_GATEWAY_PROTOCOL', { infer: true }) || 'https'
    const arweaveConfig = {
      host: arweaveHost,
      port: arweavePort,
      protocol: arweaveProtocol,
    }
    this.arweave = Arweave.init(arweaveConfig)
    this.arweaveGatewayUrl = `${arweaveProtocol}://${arweaveHost}${arweavePort !== 443 ? `:${arweavePort}` : ''}`
    this.arRefillLookbackMs =
      this.config.get<number>('AR_REFILL_LOOKBACK_MS', { infer: true }) || 7200000 // 2 hours default
    try {
      this.arweave.wallets.jwkToAddress(this.arSpender).then((address) => {
        this.arSpenderAddress = address
        this.logger.log(`Initialized refills service with arSpender [${address}]`)
      })
    } catch (error) {
      this.logger.error('Failed to initialize refills service with arSpender', error.stack)
    }
    this.ethSpender.getAddress().then((address) => {
      this.ethSpenderAddress = address
      this.logger.log(`Initialized refills service with ethSpender [${address}]`)
    })
  }

  async sendEthTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        const tx = await this.ethSpender.sendTransaction({
          to: address,
          value: ethers.parseEther(amount),
        })
        await tx.wait()
        this.logger.log(
          `EthSpender [${this.ethSpenderAddress}] finished sending [${amount}] $ETH to [${address}] with tx [${tx.hash}]`,
        )
      } else {
        this.logger.warn(
          `NOT LIVE, EthSpender [${this.ethSpenderAddress}] did NOT send [${amount}] $ETH to [${address}]`,
        )
      }

      return true
    } catch (error) {
      this.logger.error(`[alarm=refill-failed-eth] Failed to send ${amount} $ETH to ${address}`, error.stack)
      return false
    }
  }

  async sendTokensTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        const tx = await this.tokenContract.transfer(address, amount)
        await tx.wait()
        this.logger.log(
          `EthSpender [${this.ethSpenderAddress}] finished sending [${ethers.formatUnits(
            amount,
            18,
          )}] tokens to [${address}] with tx [${tx.hash}]`,
        )
      } else {
        this.logger.warn(
          `NOT LIVE, EthSpender [${this.ethSpenderAddress}] did NOT send [${ethers.formatUnits(
            amount,
            18,
          )}] tokens to [${address}]`,
        )
      }

      return true
    } catch (error) {
      this.logger.error(
        `[alarm=refill-failed-anyonetokens] EthSpender [${this.ethSpenderAddress}] failed to send [${ethers.formatUnits(
          amount,
          18,
        )}] tokens to [${address}]`,
        error.stack,
      )
      return false
    }
  }

  /**
   * Balance checks run every RECHECK_DELAY_MS (15 min in stage and live) while an Arweave
   * transfer takes tens of minutes to mine, and the recipient's balance does not move until
   * it does. Without a guard the checker therefore sees the same low balance two or three
   * times and sends the same refill two or three times over.
   *
   * ⚠️ This cooldown is in-process, so a restart inside the window loses it and one extra
   * transfer can go out. That is deliberate rather than overlooked: the residual cost is
   * over-funding a wallet WE OWN, which the node then spends, not a loss. Making it survive
   * restarts means persisting the tx id and polling its status, which is not worth the
   * machinery for that outcome.
   *
   * A gateway mempool lookup was tried first and removed: arweave.net GraphQL does NOT return
   * unconfirmed transactions (verified 2026-09-03 against a live /tx/pending id), so it would
   * have been dead code that read like protection.
   */
  private static readonly AR_SEND_COOLDOWN_MS = 60 * 60 * 1000
  private recentArSends = new Map<string, number>()

  private isArTransferInFlight(address: string): boolean {
    const sentAt = this.recentArSends.get(address)
    if (!sentAt) return false

    const elapsed = Date.now() - sentAt
    if (elapsed >= RefillsService.AR_SEND_COOLDOWN_MS) return false

    this.logger.warn(
      `Skipping $AR refill for [${address}]: one was sent ${Math.round(elapsed / 60000)} min ago and ` +
        `has not confirmed. Sending again would duplicate it.`,
    )
    return true
  }

  /**
   * Has the spender already sent $AR to this address recently?
   *
   * This is the half of the de-duplication that SURVIVES A RESTART, which the in-process
   * cooldown above cannot. Recovered from the Turbo refill path removed in b03427b, which
   * used the same lookback.
   *
   * ⚠️ arweave.net GraphQL does NOT index the mempool (verified 2026-09-03 by querying a live
   * /tx/pending id and getting nothing back), so in practice this sees MINED transfers only.
   * The unconfirmed window is what the in-process cooldown covers. A restart during that
   * window is the one remaining gap, and it over-funds a wallet we own rather than losing
   * anything.
   *
   * Returns true on ANY error: a failed lookup must never license a second spend.
   */
  private async hasRecentArTransfer(address: string): Promise<boolean> {
    const query = `
      query {
        transactions(
          owners: ["${this.arSpenderAddress}"]
          recipients: ["${address}"]
          first: 10
        ) {
          edges {
            node {
              id
              block {
                timestamp
              }
            }
          }
        }
      }
    `

    try {
      const response = await fetch(`${this.arweaveGatewayUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`)
      }

      const result: GraphQLResponse = await response.json()
      const edges = result.data?.transactions?.edges || []
      const cutoff = Date.now() - this.arRefillLookbackMs

      const recent = edges
        .map((edge) => edge.node)
        // no block yet means unconfirmed, which counts as in flight
        .filter((tx) => !tx.block?.timestamp || tx.block.timestamp * 1000 > cutoff)

      if (recent.length > 0) {
        this.logger.warn(
          `Skipping $AR refill for [${address}]: [${recent[0].id}] was already sent within the ` +
            `last ${Math.round(this.arRefillLookbackMs / 60000)} min.`,
        )
        return true
      }

      return false
    } catch (error) {
      this.logger.error(
        `Could not check for a recent $AR transfer to [${address}]; skipping the refill rather ` +
          `than risking a duplicate`,
        error.stack,
      )
      return true
    }
  }

  async sendArTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        // Two guards: the cooldown covers the unconfirmed window a gateway cannot show us,
        // the lookback survives a restart. Neither is sufficient alone.
        if (this.isArTransferInFlight(address)) {
          return false
        }

        if (await this.hasRecentArTransfer(address)) {
          return false
        }

        const arSpenderBalanceWinston = await this.arweave.wallets.getBalance(this.arSpenderAddress)
        const arSpenderBalance = this.arweave.ar.winstonToAr(arSpenderBalanceWinston)
        if (BigNumber(arSpenderBalance).lt(BigNumber(amount))) {
          this.logger.warn(
            `[alarm=refill-failed-ar] ArSpender [${this.arSpenderAddress}] does not have enough balance [${arSpenderBalance}] $AR to send [${amount}] $AR to [${address}]`,
          )
          return false
        }

        const tx = await this.arweave.createTransaction(
          {
            target: address,
            quantity: this.arweave.ar.arToWinston(amount),
          },
          this.arSpender,
        )
        await this.arweave.transactions.sign(tx, this.arSpender)
        const response = await this.arweave.transactions.post(tx)

        if (response.status === 200) {
          this.recentArSends.set(address, Date.now())
          this.logger.log(
            `ArSpender [${this.arSpenderAddress}] finished sending [${amount}] $AR to [${address}] with tx [${tx.id}]`,
          )

          return true
        }

        this.logger.warn(
          `[alarm=refill-failed-ar] Failed to send [${amount}] $AR to [${address}]: ${JSON.stringify(response)}`,
        )

        return false
      } else {
        this.logger.warn(`NOT LIVE, ArSpender [${this.arSpenderAddress}] did NOT send [${amount}] $AR to [${address}].`)
      }

      return true
    } catch (error) {
      this.logger.error(`Failed to send [${amount}] $AR to [${address}]`, error.stack)
      return false
    }
  }

  async sendAoTo(address: string, amount: string): Promise<boolean> {
    try {
      this.logger.warn('sendAoTo - Not implemented yet')

      return true
    } catch (error) {
      this.logger.error(`[alarm=refill-failed-ao] Failed to send [${amount}] $AO to [${address}]`, error.stack)
      return false
    }
  }
}
