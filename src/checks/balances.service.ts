import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { BalancesData } from './schemas/balances-data'
import BigNumber from 'bignumber.js'
import { Wallet, ethers } from 'ethers'
import Bundlr from '@bundlr-network/client'

@Injectable()
export class BalancesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BalancesService.name)

  private isLive?: string

  private tokenAddress: string | undefined

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      JSON_RPC: string
      IRYS_NODE: string
      IRYS_NETWORK: string
    }>,
    @InjectModel(BalancesData.name)
    private readonly balancesDataModel: Model<BalancesData>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', {
      infer: true,
    })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping publishing balance checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)
    }

    this.logger.log(`Initialized balance checks service`)
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`Bootstrapped Balance Checks Service`)
  }

  async publishBalanceChecks(data: BalancesData): Promise<boolean> {
    try {
      this.logger.log(`${data.stamp} ${data.kind} = ${data.amount}`)
      await this.balancesDataModel.create(data)
      return true
    } catch (error) {
      this.logger.error('Failed to store balance checks data', data)
      return false
    }
  }

  async getRelayServiceUploadBalance(): Promise<BigNumber> {
    if (this.bundlr) {
      try {
        const result = await this.bundlr.getLoadedBalance()
        if (result != undefined) {
          if (result.lt(BigNumber(this.relayRegistryUploaderMinBalance))) {
            this.logger.error(
              `Balance depletion on relay service uploader: ${result} < ${this.relayRegistryUploaderMinBalance}`,
            )
          }
          return result
        } else {
          this.logger.error(`Failed to fetch relay service uploader loaded balance`)
        }
      } catch (error) {
        this.logger.error(`Exception while fetching relay service uploader loaded balance`)
      }
    } else {
      this.logger.error('Relay registry uploader undefined. Unable to check relay service uploader balance')
    }
    return BigNumber(0)
  }

  async getRelayServiceOperatorBalance(): Promise<bigint> {
    if (this.relayRegistryOperator) {
      try {
        const result = await this.provider.getBalance(this.relayRegistryOperator.address)
        if (result != undefined) {
          if (result < BigInt(this.relayRegistryOperatorMinBalance)) {
            this.logger.error(
              `Balance depletion on relay service operator: ${result} < ${this.relayRegistryOperatorMinBalance}`,
            )
          }
          return result
        } else {
          this.logger.error(`Failed to fetch relay service operator balance`)
        }
      } catch (error) {
        this.logger.error(`Exception while fetching relay service operator balance`)
      }
    } else {
      this.logger.error('Relay registry operator undefined. Unable to check relay service operator balance')
    }
    return BigInt(0)
  }

  async getDistributionOperatorBalance(): Promise<bigint> {
    if (this.distributionOperator) {
      try {
        const result = await this.provider.getBalance(this.distributionOperator.address)
        if (result != undefined) {
          if (result < BigInt(this.distributionOperatorMinBalance)) {
            this.logger.error(
              `Balance depletion on distribution operator: ${result} < ${this.distributionOperatorMinBalance}`,
            )
          }
          return result
        } else {
          this.logger.error(`Failed to fetch relay service operator balance`)
        }
      } catch (error) {
        this.logger.error(`Exception while fetching relay service operator balance`)
      }
    } else {
      this.logger.error('Distribution operator undefined. Unable to check distribution operator balance')
    }
    return BigInt(0)
  }

  async getFacilityOperatorBalance(): Promise<bigint> {
    if (this.facilityOperator) {
      try {
        const result = await this.provider.getBalance(this.facilityOperator.address)
        if (result != undefined) {
          if (result < BigInt(this.facilityOperatorMinBalance)) {
            this.logger.error(`Balance depletion on facility operator: ${result} < ${this.facilityOperatorMinBalance}`)
          }
          return result
        } else {
          this.logger.error(`Failed to fetch facility operator balance`)
        }
      } catch (error) {
        this.logger.error(`Exception while fetching facility operator balance`)
      }
    } else {
      this.logger.error('Facility operator is undefined. Unable to check operator balance')
    }
    return BigInt(0)
  }

  async getFacilityTokenBalance(): Promise<bigint> {
    if (this.tokenAddress) {
      try {
        const contract = new ethers.Contract(this.tokenAddress, this.erc20Abi, this.provider)
        const result = await contract.balanceOf(this.facilityAddress)
        if (result != undefined) {
          if (result < BigInt(this.facilityTokenMinBalance)) {
            this.logger.error(`Balance depletion on facility token: ${result} < ${this.facilityTokenMinBalance}`)
          }
          return result
        } else {
          this.logger.error(`Failed to fetch facility token balance`)
        }
      } catch (error) {
        this.logger.error('Exception while fetching facility token balance', error)
      }
    } else {
      this.logger.error('Token address not provided. Unable to check facility token balance.')
    }

    return BigInt(0)
  }

  async getRegistratorTokenBalance(): Promise<bigint> {
    if (this.tokenAddress) {
      try {
        const contract = new ethers.Contract(this.tokenAddress, this.erc20Abi, this.provider)
        const result = await contract.balanceOf(this.registratorAddress)
        if (result != undefined) {
          return result
        } else {
          this.logger.error(`Failed to fetch registrator token balance`)
        }
      } catch (error) {
        this.logger.error('Exception while fetching registrator token balance', error)
      }
    } else {
      this.logger.error('Token address not provided. Unable to check registrator token balance.')
    }

    return BigInt(0)
  }
}
