import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue, InjectFlowProducer } from '@nestjs/bullmq'
import { Queue, FlowProducer, FlowJob } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import BigNumber from 'bignumber.js'

import { ClusterService } from '../cluster/cluster.service'

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name)

  private isLive?: string
  private doClean?: string

  static readonly removeOnComplete = true
  static readonly removeOnFail = 8
  static readonly DEFAULT_DELAY = 1000 * 60 * 5 // 5 minutes
  public readonly recheckDelay: number

  public static jobOpts = {
    removeOnComplete: TasksService.removeOnComplete,
    removeOnFail: TasksService.removeOnFail,
  }

  public static CHECK_BALANCES_FLOW(stamp: number): FlowJob {
    return {
      name: 'review-balance-checks',
      queueName: 'operator-checks-balance-checks-queue',
      data: stamp,
      opts: TasksService.jobOpts,
      children: [
        {
          name: 'check-hodler',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-hyperbeam-node',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-rewards-pool',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
      ],
    }
  }

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      DO_CLEAN: boolean
      RECHECK_DELAY_MS: string
    }>,
    @InjectQueue('operator-checks-tasks-queue')
    public tasksQueue: Queue,
    @InjectQueue('operator-checks-balance-checks-queue')
    public balancesQueue: Queue,
    @InjectQueue('operator-checks-refills-queue') public refillsQueue: Queue,
    @InjectFlowProducer('operator-checks-balance-checks-flow')
    public balancesFlow: FlowProducer,
    private readonly clusterService: ClusterService,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })
    this.recheckDelay = parseInt(
      this.config.get<string>('RECHECK_DELAY_MS', { infer: true }) ?? '',
      10,
    ) || TasksService.DEFAULT_DELAY
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Bootstrapping Tasks Service')

    if (this.clusterService.isTheOne()) {
      this.logger.log(`I am the leader, checking queue cleanup & immediate queue start`)

      if (this.isLive != 'true') {
        this.logger.log('Cleaning up tasks queue because IS_LIVE is not true')
        await this.tasksQueue.obliterate({ force: true })
      }

      if (this.doClean === 'true') {
        this.logger.log('Cleaning up tasks queue because DO_CLEAN is true')
        await this.tasksQueue.obliterate({ force: true })
      }

      this.logger.log('Queueing immediate balance checks')
      await this.queueCheckBalances({ delayJob: 0 })

      this.logger.log('Queueing immediate publishing checks')
      await this.queueCheckPublishing({ delayJob: 0 })
    } else {
      this.logger.log(`Not the leader, skipping queue cleanup check & ` + `skipping queueing immediate balance checks`)
    }
  }

  public static readonly JOB_CHECK_BALANCES = 'check-balances'
  public static readonly JOB_CHECK_PUBLISHING = 'check-publishing'

  /**
   * Count only the jobs with THIS name.
   *
   * 🚨 Counting the whole queue is what broke balance checks on 2026-09-04. Both tasks share
   * `operator-checks-tasks-queue`, and each re-queues itself with a `recheckDelay`, so one task's
   * delayed job made the other's guard see a non-empty queue and skip forever. Balance checks
   * stopped silently, and the live node wallet sat below its refill threshold for 4 days.
   * The guard exists to stop a task stacking up duplicates of ITSELF, so it must filter by name.
   */
  private async countQueued(name: string, skipActiveCheck = false): Promise<number> {
    const states: Promise<{ name: string }[]>[] = [this.tasksQueue.getWaiting(), this.tasksQueue.getDelayed()]
    if (!skipActiveCheck) states.push(this.tasksQueue.getActive())
    const jobs = (await Promise.all(states)).flat()
    return jobs.filter(j => j?.name === name).length
  }

  public async queueCheckBalances(
    opts: {
      delayJob?: number
      skipActiveCheck?: boolean
    } = {
      delayJob: this.recheckDelay,
      skipActiveCheck: false
    }
  ): Promise<void> {
    this.logger.log(
      `Checking jobs in tasks queue before queueing new check balances job ` + `with delay: ${opts.delayJob}ms`,
    )
    const numJobsInQueue = await this.countQueued(TasksService.JOB_CHECK_BALANCES, opts.skipActiveCheck)
    if (numJobsInQueue > 0) {
      this.logger.warn(`There are ${numJobsInQueue} jobs in the tasks queue, ` + `not queueing new check balances job`)
      return
    }

    this.logger.log(`Queueing check balances job with delay: ${opts.delayJob}ms`)
    await this.tasksQueue.add(
      TasksService.JOB_CHECK_BALANCES,
      {},
      {
        delay: opts.delayJob,
        removeOnComplete: TasksService.removeOnComplete,
        removeOnFail: TasksService.removeOnFail,
      },
    )
  }

  /**
   * Publishing checks ride the same tasks queue and cadence as the balance checks, but do NOT go
   * through the balance-checks FLOW: there is nothing to fan out and nothing to aggregate, and the
   * flow's queue name is about balances.
   */
  public async queueCheckPublishing(
    opts: { delayJob?: number, skipActiveCheck?: boolean } = { delayJob: this.recheckDelay },
  ): Promise<void> {
    const queued = await this.countQueued(TasksService.JOB_CHECK_PUBLISHING, opts.skipActiveCheck)
    if (queued > 0) {
      this.logger.warn(`There are ${queued} check publishing jobs already queued, not queueing another`)
      return
    }
    this.logger.log(`Queueing check publishing job with delay: ${opts.delayJob}ms`)
    await this.tasksQueue.add(
      TasksService.JOB_CHECK_PUBLISHING,
      {},
      {
        delay: opts.delayJob,
        removeOnComplete: TasksService.removeOnComplete,
        removeOnFail: TasksService.removeOnFail,
      },
    )
  }

  public async requestRefillAr(address: string, amount: BigNumber) {
    this.logger.log(`Requesting [${amount}] $AR refill for [${address}]`)
    await this.refillsQueue.add(
      'refill-ar',
      { arReceiver: address, arAmount: amount.toString() },
      {
        delay: 0,
        removeOnComplete: TasksService.removeOnComplete,
        removeOnFail: TasksService.removeOnFail,
      },
    )
  }

  public async requestRefillToken(address: string, amount: bigint): Promise<void> {
    this.logger.log(`Requesting token refill for ${address} amount: ${ethers.formatUnits(amount.toString(), 18)}`)
    const tokenAmount = amount.toString()
    await this.refillsQueue.add(
      'refill-token',
      { tokenReceiver: address, tokenAmount },
      {
        delay: 0,
        removeOnComplete: TasksService.removeOnComplete,
        removeOnFail: TasksService.removeOnFail,
      },
    )
  }

}
