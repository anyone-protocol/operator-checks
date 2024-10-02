import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { TasksQueue } from './processors/tasks-queue'
import { TasksService } from './tasks.service'
import {
  TaskServiceData,
  TaskServiceDataSchema,
} from './schemas/task-service-data'
import { MongooseModule } from '@nestjs/mongoose'
import { BalanceChecksQueue } from './processors/balance-checks-queue'
import { ChecksModule } from 'src/checks/checks.module'

@Module({
  imports: [
    ChecksModule,
    BullModule.registerQueue({
      name: 'operator-checks-tasks-queue',
      streams: { events: { maxLen: 1000 } },
    }),
    BullModule.registerQueue({
      name: 'operator-checks-balance-checks-queue',
      streams: { events: { maxLen: 500 } },
    }),
    BullModule.registerFlowProducer({ name: 'operator-checks-balance-checks-flow' }),
    MongooseModule.forFeature([
      {
        name: TaskServiceData.name,
        schema: TaskServiceDataSchema,
      },
    ]),
  ],
  providers: [TasksService, TasksQueue, BalanceChecksQueue],
  exports: [TasksService],
})
export class TasksModule {}
