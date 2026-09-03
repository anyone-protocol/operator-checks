import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { BalancesService } from 'src/checks/balances.service'
import { BalancesData } from 'src/checks/schemas/balances-data'
import { TasksService } from '../tasks.service'
import { HodlerChecksService } from 'src/checks/hodler-checks.service'
import { HyperbeamNodeChecksService } from 'src/checks/hyperbeam-node-checks.service'
import { RefillsService } from 'src/refills/refills.service'

@Processor('operator-checks-balance-checks-queue')
export class BalanceChecksQueue extends WorkerHost {
  private readonly logger = new Logger(BalanceChecksQueue.name)

  public static readonly JOB_CHECK_HODLER = 'check-hodler'
  public static readonly JOB_CHECK_HYPERBEAM_NODE = 'check-hyperbeam-node'
  public static readonly JOB_CHECK_REWARDS_POOL = 'check-rewards-pool'
  public static readonly JOB_REVIEW_BALANCE_CHECKS = 'review-balance-checks'

  constructor(
    private readonly balances: BalancesService,
    private readonly hodlerChecks: HodlerChecksService,
    private readonly hyperbeamNodeChecks: HyperbeamNodeChecksService,
    private readonly tasks: TasksService,
    private readonly refills: RefillsService,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<BalancesData[]> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case BalanceChecksQueue.JOB_CHECK_HYPERBEAM_NODE:
        try {
          const { balance, requestAmount, address } = await this.hyperbeamNodeChecks.getNodeBalance()

          if (requestAmount && address) {
            await this.tasks.requestRefillAr(address, requestAmount)
          }

          return [
            {
              stamp: job.data,
              kind: 'hyperbeam-node-ar-balance',
              amount: balance.toString(),
              requestAmount: requestAmount?.toString() || undefined,
              address,
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking hyperbeam node', error.stack)
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
