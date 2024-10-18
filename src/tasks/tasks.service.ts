import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue, InjectFlowProducer } from '@nestjs/bullmq'
import { Queue, FlowProducer, FlowJob } from 'bullmq'
import { ConfigService } from '@nestjs/config'

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
          name: 'check-registrator',
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

  public async queueCheckBalances(delayJob: number = 1000 * 60 * 5): Promise<void> {
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
}
