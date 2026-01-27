import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TurboFactory } from '@ardrive/turbo-sdk'
import BigNumber from 'bignumber.js'

@Injectable()
export class TurboCreditsChecksService {
  private readonly logger = new Logger(TurboCreditsChecksService.name)

  private isLive?: string

  private deployerAddress?: string
  private deployerMinCredits?: number
  private deployerMaxCredits?: number

  private relayRewardsAddress?: string
  private relayRewardsMinCredits?: number
  private relayRewardsMaxCredits?: number

  private stakingRewardsAddress?: string
  private stakingRewardsMinCredits?: number
  private stakingRewardsMaxCredits?: number

  private turboClient: ReturnType<typeof TurboFactory.unauthenticated>

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TURBO_DEPLOYER_ADDRESS: string
      TURBO_DEPLOYER_MIN_CREDITS: number
      TURBO_DEPLOYER_MAX_CREDITS: number
      RELAY_REWARDS_CONTROLLER_ADDRESS: string
      TURBO_RELAY_REWARDS_MIN_CREDITS: number
      TURBO_RELAY_REWARDS_MAX_CREDITS: number
      STAKING_REWARDS_CONTROLLER_ADDRESS: string
      TURBO_STAKING_REWARDS_MIN_CREDITS: number
      TURBO_STAKING_REWARDS_MAX_CREDITS: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    // Initialize unauthenticated Turbo client for balance checks
    this.turboClient = TurboFactory.unauthenticated()

    // Initialize deployer configuration
    this.deployerAddress = this.config.get<string>('TURBO_DEPLOYER_ADDRESS', { infer: true })
    if (this.deployerAddress) {
      this.deployerMinCredits = this.config.get<number>('TURBO_DEPLOYER_MIN_CREDITS', { infer: true })
      this.deployerMaxCredits = this.config.get<number>('TURBO_DEPLOYER_MAX_CREDITS', { infer: true })
      this.logger.log(`Initialized Turbo credits checks for deployer: [${this.deployerAddress}]`)
    } else {
      this.logger.warn('Missing TURBO_DEPLOYER_ADDRESS. Skipping deployer Turbo credits checks...')
    }

    // Initialize operator-registry-controller configuration
    this.relayRewardsAddress = this.config.get<string>('OPERATOR_REGISTRY_CONTROLLER_ADDRESS', { infer: true })
    if (this.relayRewardsAddress) {
      this.relayRewardsMinCredits = this.config.get<number>('TURBO_OPERATOR_REGISTRY_MIN_CREDITS', { infer: true })
      this.relayRewardsMaxCredits = this.config.get<number>('TURBO_OPERATOR_REGISTRY_MAX_CREDITS', { infer: true })
      this.logger.log(`Initialized Turbo credits checks for operator-registry-controller: [${this.relayRewardsAddress}]`)
    } else {
      this.logger.warn('Missing OPERATOR_REGISTRY_CONTROLLER_ADDRESS. Skipping operator-registry-controller Turbo credits checks...')
    }

    // Initialize relay-rewards-controller configuration
    this.relayRewardsAddress = this.config.get<string>('RELAY_REWARDS_CONTROLLER_ADDRESS', { infer: true })
    if (this.relayRewardsAddress) {
      this.relayRewardsMinCredits = this.config.get<number>('TURBO_RELAY_REWARDS_MIN_CREDITS', { infer: true })
      this.relayRewardsMaxCredits = this.config.get<number>('TURBO_RELAY_REWARDS_MAX_CREDITS', { infer: true })
      this.logger.log(`Initialized Turbo credits checks for relay-rewards-controller: [${this.relayRewardsAddress}]`)
    } else {
      this.logger.warn('Missing RELAY_REWARDS_CONTROLLER_ADDRESS. Skipping relay-rewards-controller Turbo credits checks...')
    }

    // Initialize staking-rewards-controller configuration
    this.stakingRewardsAddress = this.config.get<string>('STAKING_REWARDS_CONTROLLER_ADDRESS', { infer: true })
    if (this.stakingRewardsAddress) {
      this.stakingRewardsMinCredits = this.config.get<number>('TURBO_STAKING_REWARDS_MIN_CREDITS', { infer: true })
      this.stakingRewardsMaxCredits = this.config.get<number>('TURBO_STAKING_REWARDS_MAX_CREDITS', { infer: true })
      this.logger.log(`Initialized Turbo credits checks for staking-rewards-controller: [${this.stakingRewardsAddress}]`)
    } else {
      this.logger.warn('Missing STAKING_REWARDS_CONTROLLER_ADDRESS. Skipping staking-rewards-controller Turbo credits checks...')
    }
  }

  async checkDeployerCredits(): Promise<{
    balance: BigNumber
    requestAmount?: BigNumber
    address?: string
  }> {
    return this.checkCredits(
      this.deployerAddress,
      this.deployerMinCredits,
      this.deployerMaxCredits,
      'deployer'
    )
  }

  async checkRelayRewardsCredits(): Promise<{
    balance: BigNumber
    requestAmount?: BigNumber
    address?: string
  }> {
    return this.checkCredits(
      this.relayRewardsAddress,
      this.relayRewardsMinCredits,
      this.relayRewardsMaxCredits,
      'relay-rewards-controller'
    )
  }

  async checkStakingRewardsCredits(): Promise<{
    balance: BigNumber
    requestAmount?: BigNumber
    address?: string
  }> {
    return this.checkCredits(
      this.stakingRewardsAddress,
      this.stakingRewardsMinCredits,
      this.stakingRewardsMaxCredits,
      'staking-rewards-controller'
    )
  }

  private async checkCredits(
    address: string | undefined,
    minCredits: number | undefined,
    maxCredits: number | undefined,
    walletName: string
  ): Promise<{
    balance: BigNumber
    requestAmount?: BigNumber
    address?: string
  }> {
    if (!address) {
      this.logger.error(`${walletName} address undefined. Unable to fetch Turbo credits balance`)
      return { balance: BigNumber(0) }
    }

    if (minCredits === undefined || maxCredits === undefined) {
      this.logger.error(`${walletName} thresholds not configured. Unable to check Turbo credits`)
      return { balance: BigNumber(0), address }
    }

    try {
      // Get balance in winc (Winston Credits)
      const { winc } = await this.turboClient.getBalance(address)
      
      // Convert winc (string) to BigNumber and then to Credits (divide by 1e12)
      const wincBalance = BigNumber(winc)
      const creditsBalance = wincBalance.dividedBy(1e12)

      if (creditsBalance.lt(BigNumber(minCredits))) {
        this.logger.warn(
          `Balance depletion on ${walletName} [${address}]: ${creditsBalance.toFixed(6)} Credits < ${minCredits} Credits min`
        )
        
        return {
          balance: creditsBalance,
          requestAmount: BigNumber(maxCredits).minus(creditsBalance),
          address
        }
      } else if (creditsBalance.gt(BigNumber(maxCredits))) {
        this.logger.warn(
          `[alarm=balance-accumulation-turbo-${walletName}] Balance accumulation on ${walletName} [${address}]: ${creditsBalance.toFixed(6)} Credits > ${maxCredits} Credits max`
        )
      }

      return { balance: creditsBalance, address }
    } catch (error) {
      this.logger.error(
        `Exception while fetching Turbo credits balance for ${walletName} [${address}]`,
        error.stack
      )
      return { balance: BigNumber(0), address }
    }
  }
}
