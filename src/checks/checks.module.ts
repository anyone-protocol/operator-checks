import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { BalancesService } from './balances.service'
import { BalancesData, BalancesDataSchema } from './schemas/balances-data'
import { DistributionChecksService } from './distribution-checks.service'
import { RelayRegistryChecksService } from './relay-registry-checks.service'
import { BundlerChecksService } from './bundler-checks.service'
import { HodlerChecksService } from './hodler-checks.service'

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
    DistributionChecksService,
    RelayRegistryChecksService,
    BundlerChecksService,
    HodlerChecksService
  ],
  exports: [
    BalancesService,
    DistributionChecksService,
    RelayRegistryChecksService,
    BundlerChecksService,
    HodlerChecksService
  ],
})
export class ChecksModule {}
