import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import BigNumber from 'bignumber.js'
import { Wallet } from 'ethers'
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
      DISTRIBUTION_OPERATOR_KEY: string
      RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE: number
      RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE: number
      AO_TOKEN_PROCESS_ID: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    const operatorKey = this.config.get<string>('DISTRIBUTION_OPERATOR_KEY', { infer: true })
    if (!operatorKey) {
      this.logger.error('Missing DISTRIBUTION_OPERATOR_KEY. Skipping relay rewards operator $AO checks!')
      return
    }
    const aoTokenProcessId = this.config.get<string>('AO_TOKEN_PROCESS_ID', { infer: true })
    if (!aoTokenProcessId) {
      this.logger.error('Missing AO_TOKEN_PROCESS_ID! Skipping relay rewards operator $AO checks!')
      return
    }

    this.operatorMinAOBalance = this.config.get<number>('RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE', { infer: true })
    this.operatorMaxAOBalance = this.config.get<number>('RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE', { infer: true })
    this.aoTokenProcessId = aoTokenProcessId
    const wallet = new Wallet(operatorKey)
    wallet.getAddress().then(address => {
      this.logger.log(`Initialized relay rewards operator checks for address: [${address}]`)
      this.operatorAddress = address
    })
  }

  async getOperatorBalance(): Promise<BigNumber> {
    // const { result } = await sendAosDryRun({
    //   processId: this.aoTokenProcessId,
    //   tags: [
    //     { name: 'Action', value: 'Balance' },
    //     { name: 'Recipient', value: this.operatorAddress }
    //   ]
    // })

    // const balanceData = JSON.parse(result.Messages[0].Data)

    this.logger.warn(
      'Relay Rewards Operator balance check not yet implemented!'
    )

    return BigNumber(0)
    // throw new Error('Not yet implemented')
    // if (this.operator) {
    //   try {
    //     const result = await this.provider.getBalance(await this.operator.getAddress())
    //     if (result != undefined) {
    //       if (result < BigInt(this.operatorMinAOBalance)) {
    //         this.logger.warn(`Balance depletion on operator: ${result} < ${this.operatorMinAOBalance}`)
    //       }
    //       return result
    //     } else this.logger.error(`Failed to fetch operator balance`)
    //   } catch (error) {
    //     this.logger.error(`Exception while fetching operator balance`, error.stack)
    //   }
    // } else this.logger.error('Operator undefined. Unable to operator balance')
    // return BigInt(0)
  }
}
