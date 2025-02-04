import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { BalancesService } from 'src/checks/balances.service'
import { DistributionChecksService } from 'src/checks/distribution-checks.service'
import { FacilitatorChecksService } from 'src/checks/facilitator-checks.service'
import { RegistratorChecksService } from 'src/checks/registrator-checks.service'
import { RelayRegistryChecksService } from 'src/checks/relay-registry-checks.service'
import { BalancesData } from 'src/checks/schemas/balances-data'
import { TasksService } from '../tasks.service'
import { ConfigService } from '@nestjs/config'
import { BundlerChecksService } from 'src/checks/bundler-checks.service'

@Processor('operator-checks-balance-checks-queue')
export class BalanceChecksQueue extends WorkerHost {
  private readonly logger = new Logger(BalanceChecksQueue.name)

  public static readonly JOB_CHECK_RELAY_REGISTRY = 'check-relay-registry'
  public static readonly JOB_CHECK_DISTRIBUTION = 'check-distribution'
  public static readonly JOB_CHECK_FACILITATOR = 'check-facilitator'
  public static readonly JOB_CHECK_REGISTRATOR = 'check-registrator'
  public static readonly JOB_CHECK_BUNDLER = 'check-bundler'
  public static readonly JOB_REVIEW_BALANCE_CHECKS = 'review-balance-checks'

  private facilityContractAddress?: string

  constructor(
    private readonly balances: BalancesService,
    private readonly distributionChecks: DistributionChecksService,
    private readonly facilitatorChecks: FacilitatorChecksService,
    private readonly registratorChecks: RegistratorChecksService,
    private readonly relayRegistryChecks: RelayRegistryChecksService,
    private readonly bundlerChecks: BundlerChecksService,
    private readonly tasks: TasksService,
    private readonly config: ConfigService<{
      FACILITY_CONTRACT_ADDRESS: string
    }>
  ) {
    super()

    this.facilityContractAddress = this.config.get<string>('FACILITY_CONTRACT_ADDRESS', { infer: true })
  }

  async process(job: Job<any, any, string>): Promise<BalancesData[]> {
    this.logger.debug(`Dequeueing ${job.name} [${job.id}]`)

    switch (job.name) {
      case BalanceChecksQueue.JOB_CHECK_RELAY_REGISTRY:
        try {
          const operatorBalance = await this.relayRegistryChecks.getOperatorBalance()

          return [
            { stamp: job.data, kind: 'relay-registry-operator-ao-balance', amount: operatorBalance.toString() },
          ]
        } catch (error) {
          this.logger.error('Failed checking relay registry', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_DISTRIBUTION:
        try {
          const operatorBalance = await this.distributionChecks.getOperatorBalance()

          return [
            { stamp: job.data, kind: 'distribution-operator-ao-balance', amount: operatorBalance.toString() },
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
              requestAmount: requestAmount?.toString() || undefined
            },
          ]
        } catch (error) {
          this.logger.error('Failed checking bundler', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_FACILITATOR:
        try {
          const operatorEth = await this.facilitatorChecks.getOperatorEth()
          const contractTokens = await this.facilitatorChecks.getContractTokens()
          if (contractTokens > BigInt(0)) {
            await this.tasks.requestRefillToken(this.facilityContractAddress!, contractTokens)
          }

          return [
            { stamp: job.data, kind: 'facilitator-operator-eth', amount: operatorEth.toString() },
            { stamp: job.data, kind: 'facilitator-contract-tokens', amount: contractTokens.toString() },
          ]
        } catch (error) {
          this.logger.error('Failed checking facilitator', error.stack)
          return []
        }

      case BalanceChecksQueue.JOB_CHECK_REGISTRATOR:
        try {
          const contractTokens = await this.registratorChecks.getContractTokens()

          return [{ stamp: job.data, kind: 'registrator-contract-tokens', amount: contractTokens.toString() }]
        } catch (error) {
          this.logger.error('Failed checking registrator', error.stack)
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
}
