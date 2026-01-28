import { Module } from '@nestjs/common'
import { RefillsService } from './refills.service'

@Module({
  providers: [RefillsService],
  exports: [RefillsService],
})
export class RefillsModule {}
