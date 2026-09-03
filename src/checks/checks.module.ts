import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { BalancesService } from './balances.service'
import { BalancesData, BalancesDataSchema } from './schemas/balances-data'
import { HodlerChecksService } from './hodler-checks.service'
import { HyperbeamNodeChecksService } from './hyperbeam-node-checks.service'

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
  ],
  exports: [
    BalancesService,
    HodlerChecksService,
    HyperbeamNodeChecksService,
  ],
})
export class ChecksModule {}
