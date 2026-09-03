import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { BalancesService } from './balances.service'
import { BalancesData, BalancesDataSchema } from './schemas/balances-data'
import { HodlerChecksService } from './hodler-checks.service'
import { HyperbeamNodeChecksService } from './hyperbeam-node-checks.service'
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
    HodlerChecksService,
    HyperbeamNodeChecksService,
    TurboCreditsChecksService,
  ],
  exports: [
    BalancesService,
    HodlerChecksService,
    HyperbeamNodeChecksService,
    TurboCreditsChecksService,
  ],
})
export class ChecksModule {}
