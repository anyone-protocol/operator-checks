import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { RefillsService } from 'src/refills/refills.service'

@Processor('operator-checks-refills-queue')
export class RefillsQueue extends WorkerHost {
  private readonly logger = new Logger(RefillsQueue.name)

  public static readonly JOB_REFILL_ETH = 'refill-eth'
  public static readonly JOB_REFILL_TOKEN = 'refill-token'
  public static readonly JOB_REFILL_AR = 'refill-ar'
  public static readonly JOB_REFILL_AO = 'refill-ao'
  
  constructor(
    private readonly refills: RefillsService,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<boolean> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case RefillsQueue.JOB_REFILL_ETH:
        const { ethReceiver, ethAmount } = job.data
        try {
          const outcome = await this.refills.sendEthTo(ethReceiver, ethAmount)

          return outcome
        } catch (error) {
          this.logger.error(`Failed to refill eth balance for ${ethReceiver} ${ethAmount}`, error.stack)
          return false
        }

      case RefillsQueue.JOB_REFILL_TOKEN:
        const { tokenReceiver, tokenAmount } = job.data
        try {
          this.logger.warn(`Refilling token ${tokenAmount} for ${tokenReceiver}`)
          const outcome = await this.refills.sendTokensTo(tokenReceiver, tokenAmount)

          return outcome
        } catch (error) {
          this.logger.error(`Failed to refill token balance for ${tokenReceiver} ${tokenAmount}`, error.stack)
          return false
        }

      case RefillsQueue.JOB_REFILL_AR:
        const { arReceiver, arAmount } = job.data
        try {
          const outcome = await this.refills.sendArTo(arReceiver, arAmount)

          return outcome
        } catch (error) {
          this.logger.error(`Failed to refill token balance for ${arReceiver} ${arAmount}`, error.stack)
          return false
        }

      case RefillsQueue.JOB_REFILL_AO:
        const { uploaderAddress, uploaderAmount } = job.data
        try {
          const outcome = await this.refills.sendAoTo(uploaderAddress, uploaderAmount)

          return outcome
        } catch (error) {
          this.logger.error(`Failed to refill token balance for ${uploaderAddress} ${uploaderAmount}`, error.stack)
          return false
        }

      default:
        this.logger.warn(`Found unknown job ${job.name} [${job.id}]`)
        return false
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
