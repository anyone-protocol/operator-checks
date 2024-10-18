import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import Bundlr from '@bundlr-network/client'
import {
  EthereumSigner,
  // @ts-ignore
} from 'warp-contracts-plugin-signature/server'

@Injectable()
export class RelayRegistryChecksService {
  private readonly logger = new Logger(RelayRegistryChecksService.name)

  private isLive?: string

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  private operator
  private operatorMinBalance: number
  private operatorMaxBalance: number

  private uploader
  private uploaderMinBalance: number
  private uploaderMaxBalance: number

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      JSON_RPC: string
      RELAY_REGISTRY_OPERATOR_KEY: string
      BUNDLER_NODE: string
      BUNDLER_NETWORK: string
      RELAY_REGISTRY_UPLOADER_MIN_BALANCE: number
      RELAY_REGISTRY_UPLOADER_MAX_BALANCE: number
      RELAY_REGISTRY_OPERATOR_MIN_BALANCE: number
      RELAY_REGISTRY_OPERATOR_MAX_BALANCE: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping facility checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)
    }

    const operatorKey = this.config.get<string>('RELAY_REGISTRY_OPERATOR_KEY', { infer: true })
    if (!operatorKey) this.logger.error('Missing RELAY_REGISTRY_OPERATOR_KEY. Skipping relay registry checks...')
    else {
      this.operatorMinBalance = this.config.get<number>('RELAY_REGISTRY_OPERATOR_MIN_BALANCE', { infer: true })
      this.operatorMaxBalance = this.config.get<number>('RELAY_REGISTRY_OPERATOR_MAX_BALANCE', { infer: true })

      this.operator = (() => {
        const signer = new EthereumSigner(operatorKey)
        this.logger.log(
          `Initialized operator: ${signer.getAddress()} with bounds: ${this.operatorMinBalance}..${
            this.operatorMaxBalance
          }`,
        )
        return signer
      })()

      this.uploaderMinBalance = this.config.get<number>('RELAY_REGISTRY_UPLOADER_MIN_BALANCE', { infer: true })
      this.uploaderMaxBalance = this.config.get<number>('RELAY_REGISTRY_UPLOADER_MAX_BALANCE', { infer: true })

      this.uploader = (() => {
        const node = config.get<string>('BUNDLER_NODE', { infer: true })
        const network = config.get<string>('BUNDLER_NETWORK', { infer: true })

        if (node !== undefined && network !== undefined) {
          const bundler = new Bundlr(node, network, operatorKey)
          this.logger.log(
            `Initialized uploader: ${bundler.address} with bounds: ${this.uploaderMinBalance}..${this.uploaderMaxBalance}`,
          )
          return bundler
        } else {
          this.logger.error(`Failed to initialize using node [${node}] with network [${network}]`)
          return undefined
        }
      })()
    }
  }

  async getOperatorBalance(): Promise<bigint> {
    if (this.operator) {
      try {
        const result = await this.provider.getBalance(this.operator.getAddress())
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

  async getUploaderBalance(): Promise<BigNumber> {
    if (this.uploader) {
      try {
        const result = await this.uploader.getLoadedBalance()
        if (result != undefined) {
          if (result.lt(BigNumber(this.uploaderMinBalance))) {
            this.logger.warn(`Balance depletion on uploader: ${result} < ${this.uploaderMinBalance}`)
          }
          return result
        } else this.logger.error(`Failed to check uploader balance`)
      } catch (error) {
        this.logger.error(`Exception while fetching uploader balance`, error.stack)
      }
    } else this.logger.error('Uploader undefined. Unable to check uploader balance')
    return BigNumber(0)
  }
}
