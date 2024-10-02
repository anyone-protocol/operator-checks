import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue, InjectFlowProducer } from '@nestjs/bullmq'
import { Queue, FlowProducer, FlowJob } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { TaskServiceData } from './schemas/task-service-data'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name)

  private isLive?: string
  private doClean?: string
  private dataId: Types.ObjectId
  private state: TaskServiceData

  static readonly removeOnComplete = true
  static readonly removeOnFail = 8

  public static jobOpts = {
    removeOnComplete: TasksService.removeOnComplete,
    removeOnFail: TasksService.removeOnFail,
  }

  public static CHECK_BALANCES_FLOW(stamp: number): FlowJob {
    return {
      name: 'publish-balance-checks',
      queueName: 'operator-checks-balance-checks-queue',
      data: stamp,
      opts: TasksService.jobOpts,
      children: [
        {
          name: 'check-facility-operator',
          queueName: 'operator-checks-balance-checks-queue',
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-distribution-operator',
          queueName: 'operator-checks-balance-checks-queue',
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-relay-registry-operator',
          queueName: 'operator-checks-balance-checks-queue',
          opts: TasksService.jobOpts,
        },
        {
          name: 'check-registrator',
          queueName: 'operator-checks-balance-checks-queue',
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
    @InjectModel(TaskServiceData.name)
    private readonly taskServiceDataModel: Model<TaskServiceData>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.doClean = this.config.get<string>('DO_CLEAN', { infer: true })
    this.state = {
      isCheckingBalances: false,
    }
  }

  private async createServiceState(): Promise<void> {
    const newData = await this.taskServiceDataModel.create(this.state)
    this.dataId = newData._id
  }

  private async updateServiceState(): Promise<void> {
    const updateResult = await this.taskServiceDataModel.updateOne(
      { _id: this.dataId },
      this.state,
    )
    if (!updateResult.acknowledged) {
      this.logger.error(
        'Failed to acknowledge update of the task service state',
      )
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Bootstrapping Tasks Service')
    const hasData = await this.taskServiceDataModel.exists({})

    if (hasData) {
      const serviceData = await this.taskServiceDataModel
        .findOne({})
        .exec()
        .catch((error) => {
          this.logger.error(error)
        })

      if (serviceData != null) {
        this.dataId = serviceData._id
        this.state = {
          isCheckingBalances: serviceData.isCheckingBalances,
        }
      } else {
        this.logger.warn(
          'This should not happen. Data was deleted, or is incorrect',
        )
        this.createServiceState()
      }
    } else this.createServiceState()

    this.logger.log(
      `Bootstrapped Tasks Service [id: ${this.dataId}, isCheckingBalances: ${this.state.isCheckingBalances}]`,
    )

    if (this.doClean != 'true') {
      this.logger.log('Skipped cleaning up old jobs')
    } else {
      this.logger.log('Cleaning up old (24hrs+) jobs')
      await this.tasksQueue.clean(24 * 60 * 60 * 1000, -1)
    }

    if (this.isLive != 'true') {
      this.logger.debug('Cleaning up queues for dev...')
      await this.tasksQueue.obliterate({ force: true })

      await this.queueCheckBalances(0)
      this.logger.log('Queued immediate balance checks')
    } else {
      if (this.state.isCheckingBalances) {
        this.logger.log('The checking of balances should already be queued')
      } else {
        await this.queueCheckBalances(0)
        this.logger.log('Queued immediate balance checks')
      }
    }
  }

  public async queueCheckBalances(
    delayJob: number = 1000 * 60 * 10,
  ): Promise<void> {
    if (!this.state.isCheckingBalances) {
      this.state.isCheckingBalances = true
      await this.updateServiceState()
    }

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
