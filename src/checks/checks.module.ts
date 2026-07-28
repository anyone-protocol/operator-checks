import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { BalancesService } from './balances.service'
import { BalancesData, BalancesDataSchema } from './schemas/balances-data'
import { BundlerChecksService } from './bundler-checks.service'
import { HodlerChecksService } from './hodler-checks.service'
import { TurboCreditsChecksService } from './turbo-credits-checks.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: BalancesData.name,
        schema: BalancesDataSchema,
      },
    ]),
  ],
  providers: [
    BalancesService,
    BundlerChecksService,
    HodlerChecksService,
    TurboCreditsChecksService,
  ],
  exports: [
    BalancesService,
    BundlerChecksService,
    HodlerChecksService,
    TurboCreditsChecksService,
  ],
})
export class ChecksModule {}
