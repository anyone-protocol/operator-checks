import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import BigNumber from 'bignumber.js'
import { sendAosDryRun } from 'src/util/send-aos-message'

@Injectable()
export class DistributionChecksService {
  private readonly logger = new Logger(DistributionChecksService.name)

  private isLive?: string
  private aoBalanceChecksEnabled: boolean

  private aoTokenProcessId: string
  private relayRewardsOperatorAddress: string
  private relayRewardsOperatorMinAOBalance: number
  private relayRewardsOperatorMaxAOBalance: number
  private stakingRewardsOperatorAddress: string
  private stakingRewardsOperatorMinAOBalance: number
  private stakingRewardsOperatorMaxAOBalance: number

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      AO_BALANCE_CHECKS_ENABLED: string
      RELAY_REWARDS_CONTROLLER_ADDRESS: string
      RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE: number
      RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE: number
      STAKING_REWARDS_CONTROLLER_ADDRESS: string
      STAKING_REWARDS_OPERATOR_MIN_AO_BALANCE: number
      STAKING_REWARDS_OPERATOR_MAX_AO_BALANCE: number
      AO_TOKEN_PROCESS_ID: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    
    // AO balance checks enabled by default (only disabled when explicitly set to 'false')
    const aoChecksConfig = this.config.get<string>('AO_BALANCE_CHECKS_ENABLED', { infer: true })
    this.aoBalanceChecksEnabled = aoChecksConfig !== 'false'

    const relayRewardsOperatorAddress = this.config.get<string>('RELAY_REWARDS_CONTROLLER_ADDRESS', { infer: true })
    if (!relayRewardsOperatorAddress) {
      this.logger.error(`Missing RELAY_REWARDS_CONTROLLER_ADDRESS. Skipping relay rewards operator $AO checks!`)
      return
    }
    this.relayRewardsOperatorAddress = relayRewardsOperatorAddress

    const stakingRewardsOperatorAddress = this.config.get<string>('STAKING_REWARDS_CONTROLLER_ADDRESS', { infer: true })
    if (!stakingRewardsOperatorAddress) {
      this.logger.error(`Missing STAKING_REWARDS_CONTROLLER_ADDRESS. Skipping relay rewards operator $AO checks!`)
      return
    }
    this.stakingRewardsOperatorAddress = stakingRewardsOperatorAddress

    const aoTokenProcessId = this.config.get<string>('AO_TOKEN_PROCESS_ID', { infer: true })
    if (!aoTokenProcessId) {
      this.logger.error('Missing AO_TOKEN_PROCESS_ID! Skipping relay rewards operator $AO checks!')
      return
    }
    this.aoTokenProcessId = aoTokenProcessId

    this.relayRewardsOperatorMinAOBalance = this.config.get<number>('RELAY_REWARDS_OPERATOR_MIN_AO_BALANCE', { infer: true })
    this.relayRewardsOperatorMaxAOBalance = this.config.get<number>('RELAY_REWARDS_OPERATOR_MAX_AO_BALANCE', { infer: true })
    this.stakingRewardsOperatorMinAOBalance = this.config.get<number>('STAKING_REWARDS_OPERATOR_MIN_AO_BALANCE', { infer: true })
    this.stakingRewardsOperatorMaxAOBalance = this.config.get<number>('STAKING_REWARDS_OPERATOR_MAX_AO_BALANCE', { infer: true })
  }

  async getRelayRewardsOperatorBalance(): Promise<{
      balance: BigNumber,
      address?: string,
      requestAmount?: BigNumber
    }> {
    if (!this.aoBalanceChecksEnabled) {
      this.logger.log('Skipping relay rewards operator $AO balance check - AO balance checks disabled')
      return { balance: BigNumber(0) }
    }

    try {
      const { result } = await sendAosDryRun({
        processId: this.aoTokenProcessId,
        tags: [
          { name: 'Action', value: 'Balance' },
          { name: 'Recipient', value: this.relayRewardsOperatorAddress }
        ]
      })
      // divide by 1e12 to convert from atomic unit to $AO
      const balance = BigNumber(result.Messages[0].Data).div('1e12')

      if (balance.lt(this.relayRewardsOperatorMinAOBalance)) {
        this.logger.warn(`Balance depletion on relay rewards operator: ${balance} $AO < ${this.relayRewardsOperatorMinAOBalance} $AO`)

        return {
          balance,
          address: this.relayRewardsOperatorAddress,
          requestAmount: BigNumber(this.relayRewardsOperatorMaxAOBalance).minus(balance)
        }
      } else if (balance.gt(this.relayRewardsOperatorMaxAOBalance)) {
        this.logger.warn(`[alarm=balance-accumulation-ao-relay-rewards] Balance accumulation on relay rewards operator: ${balance} $AO > ${this.relayRewardsOperatorMaxAOBalance} $AO`)
      } else {
        this.logger.log(`Relay rewards operator balance: ${balance} $AO`)
      }

      return { balance, address: this.relayRewardsOperatorAddress }
    } catch (error) {
      this.logger.error(
        `Exception while fetching relay rewards operator $AO balance`,
        error.stack
      )
    }

    return { balance: BigNumber(0), address: this.relayRewardsOperatorAddress }
  }

  async getStakingRewardsOperatorBalance(): Promise<{
      balance: BigNumber,
      address?: string,
      requestAmount?: BigNumber
    }> {
    if (!this.aoBalanceChecksEnabled) {
      this.logger.log('Skipping staking rewards operator $AO balance check - AO balance checks disabled')
      return { balance: BigNumber(0) }
    }

    try {
      const { result } = await sendAosDryRun({
        processId: this.aoTokenProcessId,
        tags: [
          { name: 'Action', value: 'Balance' },
          { name: 'Recipient', value: this.stakingRewardsOperatorAddress }
        ]
      })
      // divide by 1e12 to convert from atomic unit to $AO
      const balance = BigNumber(result.Messages[0].Data).div('1e12')

      if (balance.lt(this.stakingRewardsOperatorMinAOBalance)) {
        this.logger.warn(`Balance depletion on staking rewards operator: ${balance} $AO < ${this.stakingRewardsOperatorMinAOBalance} $AO`)

        return {
          balance,
          address: this.stakingRewardsOperatorAddress,
          requestAmount: BigNumber(this.stakingRewardsOperatorMaxAOBalance).minus(balance)
        }
      } else if (balance.gt(this.stakingRewardsOperatorMaxAOBalance)) {
        this.logger.warn(`[alarm=balance-accumulation-ao-staking-rewards] Balance accumulation on staking rewards operator: ${balance} $AO > ${this.stakingRewardsOperatorMaxAOBalance} $AO`)
      } else {
        this.logger.log(`Staking rewards operator balance: ${balance} $AO`)
      }

      return { balance, address: this.stakingRewardsOperatorAddress }
    } catch (error) {
      this.logger.error(
        `Exception while fetching staking rewards operator $AO balance`,
        error.stack
      )
    }

    return { balance: BigNumber(0), address: this.stakingRewardsOperatorAddress }
  }
}
