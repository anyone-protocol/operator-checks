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

  static readonly removeOnComplete = true
  static readonly removeOnFail = 8

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
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Bootstrapping Tasks Service')

    if (this.isLive != 'true') {
      this.logger.debug('Cleaning up queues for dev...')
      await this.tasksQueue.obliterate({ force: true })
    }

    await this.queueCheckBalances(0)
    this.logger.log('Queued immediate balance checks')
  }

  public async queueCheckBalances(
    delayJob: number = 1000 * 60 * 5
  ): Promise<void> {
    this.logger.log(`Queueing check balances job with delay: ${delayJob}ms`)
    await this.tasksQueue.add(
      'check-balances',
      {},
      {
        delay: delayJob,
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
