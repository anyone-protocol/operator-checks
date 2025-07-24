import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import BigNumber from 'bignumber.js'
import { sendAosDryRun } from 'src/util/send-aos-message'

@Injectable()
export class DistributionChecksService {
  private readonly logger = new Logger(DistributionChecksService.name)

  private isLive?: string

  private aoTokenProcessId: string
  private operatorAddress: string
  private operatorMinAOBalance: number
  private operatorMaxAOBalance: number

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      RELAY_REWARDS_CONTROLLER_ADDRESS: string
      RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE: number
      RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE: number
      AO_TOKEN_PROCESS_ID: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    const operatorAddress = this.config.get<string>('RELAY_REWARDS_CONTROLLER_ADDRESS', { infer: true })
    if (!operatorAddress) {
      this.logger.error(`Missing RELAY_REWARDS_CONTROLLER_ADDRESS. Skipping relay rewards operator $AO checks!`)
      return
    }
    this.operatorAddress = operatorAddress

    const aoTokenProcessId = this.config.get<string>('AO_TOKEN_PROCESS_ID', { infer: true })
    if (!aoTokenProcessId) {
      this.logger.error('Missing AO_TOKEN_PROCESS_ID! Skipping relay rewards operator $AO checks!')
      return
    }
    this.aoTokenProcessId = aoTokenProcessId

    this.operatorMinAOBalance = this.config.get<number>('RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE', { infer: true })
    this.operatorMaxAOBalance = this.config.get<number>('RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE', { infer: true })
  }

  async getOperatorBalance(): Promise<{
      balance: BigNumber,
      address?: string,
      requestAmount?: BigNumber
    }> {
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
        this.logger.warn(`Balance depletion on relay rewards operator: ${balance} $AO < ${this.operatorMinAOBalance} $AO`)

        return {
          balance,
          address: this.operatorAddress,
          requestAmount: BigNumber(this.operatorMaxAOBalance).minus(balance)
        }
      } else if (balance.gt(this.operatorMaxAOBalance)) {
        this.logger.warn(`[alarm=balance-accumulation-ao-relay-rewards] Balance accumulation on relay rewards operator: ${balance} $AO > ${this.operatorMaxAOBalance} $AO`)
      } else {
        this.logger.log(`Relay rewards operator balance: ${balance} $AO`)
      }

      return { balance, address: this.operatorAddress }
    } catch (error) {
      this.logger.error(
        `Exception while fetching relay rewards operator $AO balance`,
        error.stack
      )
    }

    return { balance: BigNumber(0), address: this.operatorAddress }
  }
}
