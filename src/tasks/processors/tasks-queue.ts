import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { TasksService } from '../tasks.service'
import { PublishingChecksService } from 'src/checks/publishing-checks.service'

@Processor('operator-checks-tasks-queue')
export class TasksQueue extends WorkerHost {
  private readonly logger = new Logger(TasksQueue.name)

  public static readonly JOB_CHECK_BALANCES = 'check-balances'
  public static readonly JOB_CHECK_PUBLISHING = 'check-publishing'

  constructor(
    private readonly tasks: TasksService,
    private readonly publishingChecks: PublishingChecksService,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case TasksQueue.JOB_CHECK_BALANCES:
        this.tasks.balancesFlow.add(TasksService.CHECK_BALANCES_FLOW(Date.now()))
        this.tasks.queueCheckBalances({
          delayJob: this.tasks.recheckDelay,
          skipActiveCheck: true
        })
        break

      case TasksQueue.JOB_CHECK_PUBLISHING:
        await this.publishingChecks.run()
        this.tasks.queueCheckPublishing({ delayJob: this.tasks.recheckDelay })
        break

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)
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
