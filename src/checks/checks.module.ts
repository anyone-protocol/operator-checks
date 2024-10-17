import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { BalancesService } from './balances.service'
import { BalancesData, BalancesDataSchema } from './schemas/balances-data'
import { DistributionChecksService } from './distribution-checks.service'
import { FacilitatorChecksService } from './facilitator-checks.service'
import { RegistratorChecksService } from './registrator-checks.service'
import { RelayRegistryChecksService } from './relay-registry-checks.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: BalancesData.name,
        schema: BalancesDataSchema,
      },
    ]),
  ],
  providers: [BalancesService],
  exports: [
    BalancesService,
    DistributionChecksService,
    FacilitatorChecksService,
    RegistratorChecksService,
    RelayRegistryChecksService,
  ],
})
export class ChecksModule {}
