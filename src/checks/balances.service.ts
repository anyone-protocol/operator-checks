import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { BalancesData } from './schemas/balances-data'
import { ethers } from 'ethers'

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name)

  constructor(
    @InjectModel(BalancesData.name)
    private readonly balancesDataModel: Model<BalancesData>,
  ) {
    this.logger.log(`Initialized balances service`)
  }

  async publishBalanceChecks(data: BalancesData[]): Promise<boolean> {
    try {
      // data.forEach((entry) => this.logger.log(`${entry.stamp} ${entry.kind} = ${ethers.formatUnits(entry.amount, 18)}`))
      await this.balancesDataModel.create(data)
      return true
    } catch (error) {
      this.logger.error('Failed to store balance checks data', data)
      return false
    }
  }
}
