import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Arweave from 'arweave'
import BigNumber from 'bignumber.js'
import { ethers, Wallet } from 'ethers'

@Injectable()
export class RelayRegistryChecksService {
  private readonly logger = new Logger(RelayRegistryChecksService.name)

  private isLive?: string

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  private aoTokenProcessId: string
  private operatorAddress: string
  private operatorMinAOBalance: number
  private operatorMaxAOBalance: number

  private arweave = Arweave.init({})

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      RELAY_REGISTRY_OPERATOR_KEY: string
      OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE: number
      OPERATOR_REGISTRY_OPERATOR_MAX_AO_BALANCE: number
      AO_TOKEN_PROCESS_ID: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    const operatorJWK = this.config.get<string>('RELAY_REGISTRY_OPERATOR_KEY', { infer: true })
    if (!operatorJWK) {
      this.logger.error('Missing RELAY_REGISTRY_OPERATOR_KEY. Skipping operator registry operator $AO checks!')
      return
    }
    const aoTokenProcessId = this.config.get<string>('AO_TOKEN_PROCESS_ID', { infer: true })
    if (!aoTokenProcessId) {
      this.logger.error('Missing AO_TOKEN_PROCESS_ID! Skipping operator registry operator $AO checks!')
      return
    }
    this.operatorMinAOBalance = this.config.get<number>('OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE', { infer: true })
    this.operatorMaxAOBalance = this.config.get<number>('OPERATOR_REGISTRY_OPERATOR_MAX_AO_BALANCE', { infer: true })
    this.aoTokenProcessId = aoTokenProcessId
    this.arweave.wallets
      .jwkToAddress(JSON.parse(operatorJWK))
      .then(address => {
        this.logger.log(`Initialized operator registry operator checks for address: [${address}]`)
        this.operatorAddress = address
      })
  }

  async getOperatorBalance(): Promise<BigNumber> {
    this.logger.warn(
      'Operator Registry Operator balance check not yet implemented!'
    )

    return BigNumber(0)
  }
}
