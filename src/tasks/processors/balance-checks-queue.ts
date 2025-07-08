import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { BalancesService } from 'src/checks/balances.service'
import { DistributionChecksService } from 'src/checks/distribution-checks.service'
import { FacilitatorChecksService } from 'src/checks/facilitator-checks.service'
import { RelayRegistryChecksService } from 'src/checks/relay-registry-checks.service'
import { BalancesData } from 'src/checks/schemas/balances-data'
import { TasksService } from '../tasks.service'
import { BundlerChecksService } from 'src/checks/bundler-checks.service'
import { HodlerChecksService } from 'src/checks/hodler-checks.service'

@Processor('operator-checks-balance-checks-queue')
export class BalanceChecksQueue extends WorkerHost {
  private readonly logger = new Logger(BalanceChecksQueue.name)

  public static readonly JOB_CHECK_RELAY_REGISTRY = 'check-relay-registry'
  public static readonly JOB_CHECK_DISTRIBUTION = 'check-distribution'
  public static readonly JOB_CHECK_FACILITATOR = 'check-facilitator'
  public static readonly JOB_CHECK_BUNDLER = 'check-bundler'
  public static readonly JOB_REVIEW_BALANCE_CHECKS = 'review-balance-checks'
  public static readonly JOB_CHECK_HODLER = 'check-hodler'

  constructor(
    private readonly balances: BalancesService,
    private readonly distributionChecks: DistributionChecksService,
    private readonly facilitatorChecks: FacilitatorChecksService,
    private readonly relayRegistryChecks: RelayRegistryChecksService,
    private readonly bundlerChecks: BundlerChecksService,
    private readonly hodlerChecks: HodlerChecksService,
    private readonly tasks: TasksService
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<BalancesData[]> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case BalanceChecksQueue.JOB_CHECK_RELAY_REGISTRY:
        try {
          const {
            balance,
            requestAmount,
            address
          } = await this.relayRegistryChecks.getOperatorBalance()

          return [
            {
              stamp: job.data,
              kind: 'relay-registry-operator-ao-balance',
              amount: balance.toString(),
              address,
              requestAmount: requestAmount?.toString() || undefined
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking relay registry', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_DISTRIBUTION:
        try {
          const {
            balance,
            requestAmount,
            address
          } = await this.distributionChecks.getOperatorBalance()

          return [
            {
              stamp: job.data,
              kind: 'distribution-operator-ao-balance',
              amount: balance.toString(),
              address,
              requestAmount: requestAmount?.toString() || undefined
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking distribution', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_BUNDLER:
        try {
          const {
            balance,
            requestAmount,
            address
          } = await this.bundlerChecks.getOperatorBalance()

          if (requestAmount && address) {
            await this.tasks.requestRefillAr(address, requestAmount)
          }

          return [
            {
              stamp: job.data,
              kind: 'bundler-operator-ar-balance',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking bundler', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_FACILITATOR:
        try {
          const ethCheck = await this.facilitatorChecks.getOperatorEth()
          const tokensCheck = await this.facilitatorChecks.getContractTokens()

          if (tokensCheck.requestAmount && tokensCheck.address) {
            await this.tasks.requestRefillToken(
              tokensCheck.address,
              tokensCheck.requestAmount
            )
          }

          return [
            {
              stamp: job.data,
              kind: 'facilitator-operator-eth',
              amount: ethCheck.balance.toString(),
              requestAmount: ethCheck.requestAmount?.toString() || undefined,
              address: ethCheck.address
            },
            {
              stamp: job.data,
              kind: 'facilitator-contract-tokens',
              amount: tokensCheck.balance.toString(),
              requestAmount: tokensCheck.requestAmount?.toString() || undefined,
              address: tokensCheck.address
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking facilitator', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_HODLER:
        try {
          const ethCheck = await this.hodlerChecks.getOperatorEth()
          const tokensCheck = await this.hodlerChecks.getContractTokens()
          const rewardsPoolCheck = await this.hodlerChecks.getRewardsPoolTokens()

          if (tokensCheck.requestAmount && tokensCheck.address) {
            await this.tasks.requestRefillToken(
              tokensCheck.address,
              tokensCheck.requestAmount
            )
          }

          if (rewardsPoolCheck.requestAmount && rewardsPoolCheck.address) {
            await this.tasks.requestRefillToken(
              rewardsPoolCheck.address,
              rewardsPoolCheck.requestAmount
            )
          }

          return [
            {
              stamp: job.data,
              kind: 'hodler-operator-eth',
              amount: ethCheck.balance.toString(),
              requestAmount: ethCheck.requestAmount?.toString() || undefined,
              address: ethCheck.address
            },
            {
              stamp: job.data,
              kind: 'hodler-contract-tokens',
              amount: tokensCheck.balance.toString(),
              requestAmount: tokensCheck.requestAmount?.toString() || undefined,
              address: tokensCheck.address
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking hodler', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_REVIEW_BALANCE_CHECKS:
        const balanceChecks: BalancesData[] = Object.values(await job.getChildrenValues()).reduce(
          (prev, curr) => curr.concat(prev),
          [],
        )

        const publishResult = await this.balances.publishBalanceChecks(balanceChecks)
        if (!publishResult) {
          this.logger.error('Failed publishing balance checks', balanceChecks)
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
