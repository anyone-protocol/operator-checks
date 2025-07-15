import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue, InjectFlowProducer } from '@nestjs/bullmq'
import { Queue, FlowProducer, FlowJob } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import BigNumber from 'bignumber.js'

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name)

  private isLive?: string
  private doClean?: string

  static readonly removeOnComplete = true
  static readonly removeOnFail = 8
  static readonly DEFAULT_DELAY = 1000 * 60 * 5 // 5 minutes

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
          name: 'check-facilitator',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-distribution',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-relay-registry',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-bundler',
          queueName: 'operator-checks-balance-checks-queue',
          data: stamp,
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-hodler',
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
    }>,
    @InjectQueue('operator-checks-tasks-queue') public tasksQueue: Queue,
    @InjectQueue('operator-checks-balance-checks-queue') public balancesQueue: Queue,
    @InjectQueue('operator-checks-refills-queue') public refillsQueue: Queue,
    @InjectFlowProducer('operator-checks-balance-checks-flow')
    public balancesFlow: FlowProducer,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Bootstrapping Tasks Service')

    if (this.isLive != 'true') {
      this.logger.debug('Cleaning up tasks queue because IS_LIVE is not true')
      await this.tasksQueue.obliterate({ force: true })
    }

    if (this.doClean === 'true') {
      this.logger.debug('Cleaning up tasks queue because DO_CLEAN is true')
      await this.tasksQueue.obliterate({ force: true })
    }

    await this.queueCheckBalances({ delayJob: 0 })
    this.logger.log('Queued immediate balance checks')
  }

  public async queueCheckBalances(
    opts: {
      delayJob?: number
      skipActiveCheck?: boolean
    } = {
      delayJob: TasksService.DEFAULT_DELAY,
      skipActiveCheck: false
    }
  ): Promise<void> {
    this.logger.log(
      `Checking jobs in tasks queue before queueing new check balances job ` +
        `with delay: ${opts.delayJob}ms`
    )
    let numJobsInQueue = 0
    numJobsInQueue += await this.tasksQueue.getWaitingCount()
    numJobsInQueue += await this.tasksQueue.getDelayedCount()
    if (!opts.skipActiveCheck) {
      numJobsInQueue += await this.tasksQueue.getActiveCount()
    }
    if (numJobsInQueue > 0) {
      this.logger.warn(
        `There are ${numJobsInQueue} jobs in the tasks queue, ` +
          `not queueing new check balances job`
      )
      return
    }

    this.logger.log(
      `Queueing check balances job with delay: ${opts.delayJob}ms`
    )
    await this.tasksQueue.add(
      'check-balances',
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
