import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers, Wallet } from 'ethers'

@Injectable()
export class DistributionChecksService {
  private readonly logger = new Logger(DistributionChecksService.name)

  private isLive?: string

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  private operator
  private operatorMinBalance: number
  private operatorMaxBalance: number

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      JSON_RPC: string
      BUNDLER_NODE: string
      BUNDLER_NETWORK: string
      DISTRIBUTION_OPERATOR_KEY: string
      DISTRIBUTION_OPERATOR_MIN_BALANCE: number
      DISTRIBUTION_OPERATOR_MAX_BALANCE: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping facility checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)
    }

    const operatorKey = this.config.get<string>('DISTRIBUTION_OPERATOR_KEY', { infer: true })
    if (!operatorKey) this.logger.error('Missing DISTRIBUTION_OPERATOR_KEY. Skipping distribution checks...')
    else {
      this.operatorMinBalance = this.config.get<number>('DISTRIBUTION_OPERATOR_MIN_BALANCE', { infer: true })
      this.operatorMaxBalance = this.config.get<number>('DISTRIBUTION_OPERATOR_MAX_BALANCE', { infer: true })

      this.operator = (() => {
        const signer = new Wallet(operatorKey)
        signer
          .getAddress()
          .then(address =>
            this.logger.log(
              `Initialized operator: ${address}` +
                ` with bounds:` +
                ` ${this.operatorMinBalance}..${this.operatorMaxBalance}`
            )
          )
          
        return signer
      })()
    }
  }

  async getOperatorBalance(): Promise<bigint> {
    if (this.operator) {
      try {
        const result = await this.provider.getBalance(await this.operator.getAddress())
        if (result != undefined) {
          if (result < BigInt(this.operatorMinBalance)) {
            this.logger.warn(`Balance depletion on operator: ${result} < ${this.operatorMinBalance}`)
          }
          return result
        } else this.logger.error(`Failed to fetch operator balance`)
      } catch (error) {
        this.logger.error(`Exception while fetching operator balance`, error.stack)
      }
    } else this.logger.error('Operator undefined. Unable to operator balance')
    return BigInt(0)
  }
}
