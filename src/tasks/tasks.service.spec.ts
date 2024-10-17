import { Test, TestingModule } from '@nestjs/testing'
import { TasksService } from './tasks.service'
import { BullModule } from '@nestjs/bullmq'
import { ConfigModule } from '@nestjs/config'

describe('TasksService', () => {
  let service: TasksService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.registerQueue({
          name: 'operator-checks-tasks-queue',
          connection: { host: 'localhost', port: 6379 },
        }),
        BullModule.registerQueue({
          name: 'operator-checks-balance-checks-queue',
          connection: { host: 'localhost', port: 6379 },
        }),
        BullModule.registerFlowProducer({
          name: 'operator-checks-balance-checks-flow',
          connection: { host: 'localhost', port: 6379 },
        }),
      ],
      providers: [TasksService],
    }).compile()

    service = module.get<TasksService>(TasksService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
