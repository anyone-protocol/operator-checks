import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Arweave from 'arweave'
import BigNumber from 'bignumber.js'

@Injectable()
export class BundlerChecksService {
  private readonly logger = new Logger(BundlerChecksService.name)

  private isLive?: string

  private bundlerAddress: string
  private operatorMinBalance: number
  private operatorMaxBalance: number

  private arweave: Arweave

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      BUNDLER_OPERATOR_JWK: string
      BUNDLER_MIN_AR: number
      BUNDLER_MAX_AR: number
      ARWEAVE_GATEWAY_PROTOCOL: string
      ARWEAVE_GATEWAY_HOST: string
      ARWEAVE_GATEWAY_PORT: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    const operatorJWK = this.config.get<string>('BUNDLER_OPERATOR_JWK', { infer: true })
    if (!operatorJWK) {
      this.logger.error(
        'Missing BUNDLER_OPERATOR_JWK. Skipping bundler operator checks...'
      )
    } else {
      this.operatorMinBalance = this.config.get<number>('BUNDLER_MIN_AR', { infer: true })
      this.operatorMaxBalance = this.config.get<number>('BUNDLER_MAX_AR', { infer: true })
      const arweaveConfig = {
        host: this.config.get<string>('ARWEAVE_GATEWAY_HOST', { infer: true }) || 'arweave.net',
        port: this.config.get<number>('ARWEAVE_GATEWAY_PORT', { infer: true }) || 443,
        protocol: this.config.get<string>('ARWEAVE_GATEWAY_PROTOCOL', { infer: true }) || 'https'
      }
      this.arweave = Arweave.init(arweaveConfig)
      this.arweave.wallets
        .jwkToAddress(JSON.parse(operatorJWK))
        .then(address => {
          this.logger.log(`Initialized bundler operator checks for address: [${address}]`)
          this.bundlerAddress = address
        })
    }
  }

  async getOperatorBalance(): Promise<BigNumber> {
    if (this.bundlerAddress) {
      try {
        const winstonBalance = await this.arweave.wallets.getBalance(this.bundlerAddress)
        const arBalance = BigNumber(this.arweave.ar.winstonToAr(winstonBalance))
        if (arBalance.lt(BigNumber(this.operatorMinBalance))) {
          this.logger.warn(`Balance depletion on operator [${this.bundlerAddress}]: ${arBalance} $AR < ${this.operatorMinBalance} $AR min`)
        } else if (arBalance.gt(BigNumber(this.operatorMaxBalance))) {
          this.logger.warn(`Balance accumulation on operator [${this.bundlerAddress}]: ${arBalance} $AR > ${this.operatorMaxBalance} $AR max`)
        }
        return arBalance
      } catch (error) {
        this.logger.error(`Exception while fetching operator balance`, error.stack)
      }
    } else this.logger.error('Operator undefined. Unable to fetch operator balance')

    return BigNumber(0)
  }
}
