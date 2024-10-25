import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { TasksQueue } from './processors/tasks-queue'
import { TasksService } from './tasks.service'
import { BalanceChecksQueue } from './processors/balance-checks-queue'
import { ChecksModule } from 'src/checks/checks.module'
import { RefillsModule } from 'src/refills/refills.module'
import { RefillsQueue } from './processors/refills-queue'

@Module({
  imports: [
    ChecksModule,
    RefillsModule,
    BullModule.registerQueue({
      name: 'operator-checks-tasks-queue',
      streams: { events: { maxLen: 1000 } },
    }),
    BullModule.registerQueue({
      name: 'operator-checks-balance-checks-queue',
      streams: { events: { maxLen: 500 } },
    }),
    BullModule.registerQueue({
      name: 'operator-checks-refills-queue',
      streams: { events: { maxLen: 500 } },
    }),
    BullModule.registerFlowProducer({ name: 'operator-checks-balance-checks-flow' }),
  ],
  providers: [TasksService, TasksQueue, BalanceChecksQueue, RefillsQueue],
  exports: [TasksService],
})
export class TasksModule {}
