import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { BalancesService } from 'src/checks/balances.service'
import { DistributionChecksService } from 'src/checks/distribution-checks.service'
import { RelayRegistryChecksService } from 'src/checks/relay-registry-checks.service'
import { BalancesData } from 'src/checks/schemas/balances-data'
import { TasksService } from '../tasks.service'
import { BundlerChecksService } from 'src/checks/bundler-checks.service'
import { HodlerChecksService } from 'src/checks/hodler-checks.service'
import { TurboCreditsChecksService } from 'src/checks/turbo-credits-checks.service'
import { RefillsService } from 'src/refills/refills.service'

@Processor('operator-checks-balance-checks-queue')
export class BalanceChecksQueue extends WorkerHost {
  private readonly logger = new Logger(BalanceChecksQueue.name)

  public static readonly JOB_CHECK_RELAY_REGISTRY = 'check-relay-registry'
  public static readonly JOB_CHECK_BUNDLER = 'check-bundler'
  public static readonly JOB_CHECK_RELAY_REWARDS = 'check-relay-rewards'
  public static readonly JOB_CHECK_STAKING_REWARDS = 'check-staking-rewards'
  public static readonly JOB_CHECK_HODLER = 'check-hodler'
  public static readonly JOB_CHECK_REWARDS_POOL = 'check-rewards-pool'
  public static readonly JOB_CHECK_TURBO_DEPLOYER = 'check-turbo-deployer'
  public static readonly JOB_CHECK_TURBO_OPERATOR_REGISTRY = 'check-turbo-operator-registry'
  public static readonly JOB_CHECK_TURBO_RELAY_REWARDS = 'check-turbo-relay-rewards'
  public static readonly JOB_CHECK_TURBO_STAKING_REWARDS = 'check-turbo-staking-rewards'
  public static readonly JOB_REVIEW_BALANCE_CHECKS = 'review-balance-checks'

  constructor(
    private readonly balances: BalancesService,
    private readonly distributionChecks: DistributionChecksService,
    private readonly relayRegistryChecks: RelayRegistryChecksService,
    private readonly bundlerChecks: BundlerChecksService,
    private readonly hodlerChecks: HodlerChecksService,
    private readonly turboCreditsChecks: TurboCreditsChecksService,
    private readonly tasks: TasksService,
    private readonly refills: RefillsService,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<BalancesData[]> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case BalanceChecksQueue.JOB_CHECK_RELAY_REGISTRY:
        try {
          const { balance, requestAmount, address } = await this.relayRegistryChecks.getOperatorBalance()

          return [
            {
              stamp: job.data,
              kind: 'relay-registry-operator-ao-balance',
              amount: balance.toString(),
              address,
              requestAmount: requestAmount?.toString() || undefined,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking relay registry', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_RELAY_REWARDS:
        try {
          const { balance, requestAmount, address } = await this.distributionChecks.getRelayRewardsOperatorBalance()

          return [
            {
              stamp: job.data,
              kind: 'relay-rewards-operator-ao-balance',
              amount: balance.toString(),
              address,
              requestAmount: requestAmount?.toString() || undefined,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking relay rewards operator', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_STAKING_REWARDS:
        try {
          const { balance, requestAmount, address } = await this.distributionChecks.getStakingRewardsOperatorBalance()

          return [
            {
              stamp: job.data,
              kind: 'staking-rewards-operator-ao-balance',
              amount: balance.toString(),
              address,
              requestAmount: requestAmount?.toString() || undefined,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking staking rewards operator', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_BUNDLER:
        try {
          const { balance, requestAmount, address } = await this.bundlerChecks.getOperatorBalance()

          if (requestAmount && address) {
            await this.tasks.requestRefillAr(address, requestAmount)
          }

          return [
            {
              stamp: job.data,
              kind: 'bundler-operator-ar-balance',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking bundler', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_HODLER:
        try {
          const ethCheck = await this.hodlerChecks.getOperatorEth()

          return [
            {
              stamp: job.data,
              kind: 'hodler-operator-eth',
              amount: ethCheck.balance.toString(),
              requestAmount: ethCheck.requestAmount?.toString() || undefined,
              address: ethCheck.address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking hodler', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_REWARDS_POOL:
        try {
          const rewardsPoolCheck = await this.hodlerChecks.getRewardsPoolTokens()

          if (rewardsPoolCheck.requestAmount && rewardsPoolCheck.address) {
            await this.tasks.requestRefillToken(rewardsPoolCheck.address, rewardsPoolCheck.requestAmount)
          }

          return [
            {
              stamp: job.data,
              kind: 'rewards-pool-tokens',
              amount: rewardsPoolCheck.balance.toString(),
              requestAmount: rewardsPoolCheck.requestAmount?.toString() || undefined,
              address: rewardsPoolCheck.address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking rewards pool', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_TURBO_DEPLOYER:
        try {
          const { balance, requestAmount, address } = await this.turboCreditsChecks.checkDeployerCredits()

          if (requestAmount && address) {
            const hasPending = await this.refills.hasPendingTurboRefill(address)
            if (hasPending) {
              this.logger.log(`Skipping turbo-deployer refill for [${address}] - pending transaction exists`)
            } else {
              await this.tasks.requestRefillTurboCredits(address, requestAmount)
            }
          }

          return [
            {
              stamp: job.data,
              kind: 'turbo-deployer-credits',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking Turbo deployer credits', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_TURBO_OPERATOR_REGISTRY:
        try {
          const { balance, requestAmount, address } = await this.turboCreditsChecks.checkOperatorRegistryCredits()

          if (requestAmount && address) {
            const hasPending = await this.refills.hasPendingTurboRefill(address)
            if (hasPending) {
              this.logger.log(`Skipping turbo-operator-registry refill for [${address}] - pending transaction exists`)
            } else {
              await this.tasks.requestRefillTurboCredits(address, requestAmount)
            }
          }

          return [
            {
              stamp: job.data,
              kind: 'turbo-operator-registry-credits',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking Turbo operator-registry credits', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_TURBO_RELAY_REWARDS:
        try {
          const { balance, requestAmount, address } = await this.turboCreditsChecks.checkRelayRewardsCredits()

          if (requestAmount && address) {
            const hasPending = await this.refills.hasPendingTurboRefill(address)
            if (hasPending) {
              this.logger.log(`Skipping turbo-relay-rewards refill for [${address}] - pending transaction exists`)
            } else {
              await this.tasks.requestRefillTurboCredits(address, requestAmount)
            }
          }

          return [
            {
              stamp: job.data,
              kind: 'turbo-relay-rewards-credits',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking Turbo relay-rewards credits', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_TURBO_STAKING_REWARDS:
        try {
          const { balance, requestAmount, address } = await this.turboCreditsChecks.checkStakingRewardsCredits()

          if (requestAmount && address) {
            const hasPending = await this.refills.hasPendingTurboRefill(address)
            if (hasPending) {
              this.logger.log(`Skipping turbo-staking-rewards refill for [${address}] - pending transaction exists`)
            } else {
              await this.tasks.requestRefillTurboCredits(address, requestAmount)
            }
          }

          return [
            {
              stamp: job.data,
              kind: 'turbo-staking-rewards-credits',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking Turbo staking-rewards credits', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_REVIEW_BALANCE_CHECKS:
        const balanceChecks: BalancesData[] = Object.values(await job.getChildrenValues()).reduce(
          (prev, curr) => curr.concat(prev),
          [],
        )

        const result = await this.balances.storeCheckResults(balanceChecks)
        if (!result) {
          this.logger.error('Failed storing balance checks', balanceChecks)
        }

        return balanceChecks

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)
        return []
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<any, any, string>) {
    this.logger.debug(`Finished ${job.name} [${job.id}]`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<any, any, string>) {
    this.logger.error(`[alarm=failed-job-${job.name}] Failed ${job.name} [${job.id}]: ${job.failedReason}`)
  }
}
