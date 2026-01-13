import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import BigNumber from 'bignumber.js'
import { sendAosDryRun } from 'src/util/send-aos-message'

@Injectable()
export class RelayRegistryChecksService {
  private readonly logger = new Logger(RelayRegistryChecksService.name)

  private isLive?: string
  private aoBalanceChecksEnabled: boolean

  private aoTokenProcessId: string
  private operatorAddress: string
  private operatorMinAOBalance: number
  private operatorMaxAOBalance: number

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      AO_BALANCE_CHECKS_ENABLED: string
      OPERATOR_REGISTRY_CONTROLLER_ADDRESS: string
      OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE: number
      OPERATOR_REGISTRY_OPERATOR_MAX_AO_BALANCE: number
      AO_TOKEN_PROCESS_ID: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    
    // AO balance checks enabled by default (only disabled when explicitly set to 'false')
    const aoChecksConfig = this.config.get<string>('AO_BALANCE_CHECKS_ENABLED', { infer: true })
    this.aoBalanceChecksEnabled = aoChecksConfig !== 'false'

    const operatorAddress = this.config.get<string>('OPERATOR_REGISTRY_CONTROLLER_ADDRESS', { infer: true })
    if (!operatorAddress) {
      this.logger.error('Missing OPERATOR_REGISTRY_CONTROLLER_ADDRESS. Skipping operator registry operator $AO checks!')
      return
    }
    this.operatorAddress = operatorAddress

    const aoTokenProcessId = this.config.get<string>('AO_TOKEN_PROCESS_ID', { infer: true })
    if (!aoTokenProcessId) {
      this.logger.error('Missing AO_TOKEN_PROCESS_ID! Skipping operator registry operator $AO checks!')
      return
    }
    this.operatorMinAOBalance = this.config.get<number>('OPERATOR_REGISTRY_OPERATOR_MIN_AO_BALANCE', { infer: true })
    this.operatorMaxAOBalance = this.config.get<number>('OPERATOR_REGISTRY_OPERATOR_MAX_AO_BALANCE', { infer: true })
    this.aoTokenProcessId = aoTokenProcessId
  }

  async getOperatorBalance(): Promise<{
    balance: BigNumber,
    address?: string,
    requestAmount?: BigNumber
  }> {
    if (!this.aoBalanceChecksEnabled) {
      this.logger.log('Skipping operator registry operator $AO balance check - AO balance checks disabled')
      return { balance: BigNumber(0) }
    }

    try {
      const { result } = await sendAosDryRun({
        processId: this.aoTokenProcessId,
        tags: [
          { name: 'Action', value: 'Balance' },
          { name: 'Recipient', value: this.operatorAddress }
        ]
      })
      // divide by 10e11 to convert from atomic unit to $AO
      const balance = BigNumber(result.Messages[0].Data).div('10e11')

      if (balance.lt(this.operatorMinAOBalance)) {
        this.logger.warn(`Balance depletion on operator registry operator: ${balance} $AO < ${this.operatorMinAOBalance} $AO`)

        return {
          balance,
          address: this.operatorAddress,
          requestAmount: BigNumber(this.operatorMaxAOBalance).minus(balance)
        }
      } else if (balance.gt(this.operatorMaxAOBalance)) {
        this.logger.warn(`[alarm=balance-accumulation-ao-operator-registry] Balance accumulation on operator registry operator: ${balance} $AO > ${this.operatorMaxAOBalance} $AO`)
      } else {
        this.logger.log(`operator registry operator balance: ${balance} $AO`)
      }

      return { balance, address: this.operatorAddress }
    } catch (error) {
      this.logger.error(
        `Exception while fetching operator registry operator $AO balance`,
        error.stack
      )
    }

    return { balance: BigNumber(0), address: this.operatorAddress }
  }
}
