import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { BalancesData } from './schemas/balances-data'
import BigNumber from 'bignumber.js'
import { Wallet, ethers } from 'ethers'

@Injectable()
export class FacilitatorChecksService {
  private readonly logger = new Logger(FacilitatorChecksService.name)

  private isLive?: string

  private facilityOperator: ethers.Wallet
  private facilityAddress: string | undefined
  private facilityContractMinToken: number
  private facilityContractMaxToken: number
  private facilityOperatorMinEth: number
  private facilityOperatorMaxEth: number

  private erc20Abi = ['function balanceOf(address owner) view returns (uint256)']
  private tokenAddress: string | undefined

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      FACILITY_CONTRACT_ADDRESS: string
      FACILITY_OPERATOR_KEY: string
      JSON_RPC: string
      FACILITY_OPERATOR_MIN_ETH: number
      FACILITY_OPERATOR_MAX_ETH: number
      FACILITY_CONTRACT_MIN_TOKEN: number
      FACILITY_CONTRACT_MAX_TOKEN: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', {
      infer: true,
    })

    this.facilityAddress = this.config.get<string>('FACILITY_CONTRACT_ADDRESS', { infer: true })
    this.facilityOperatorMinEth = this.config.get<number>('FACILITY_OPERATOR_MIN_ETH', { infer: true })
    this.facilityOperatorMaxEth = this.config.get<number>('FACILITY_OPERATOR_MAX_ETH', { infer: true })
    this.facilityContractMinToken = this.config.get<number>('FACILITY_CONTRACT_MIN_TOKEN', { infer: true })
    this.facilityContractMaxToken = this.config.get<number>('FACILITY_CONTRACT_MAX_TOKEN', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping facility checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)

      const facilityOperatorKey = this.config.get<string>('FACILITY_OPERATOR_KEY', { infer: true })

      if (facilityOperatorKey == undefined) {
        this.logger.error('Missing FACILITY_OPERATOR_KEY. Skipping facility checks...')
      } else {
        this.facilityOperator = new ethers.Wallet(facilityOperatorKey, this.provider)
      }

      this.logger.log(
        `Initialized balance checks for facility ${this.facilityAddress} with operator ${this.facilityOperator.address} and token: ${this.tokenAddress}`,
      )
    }
  }

  async getFacilityOperatorBalance(): Promise<bigint> {
    if (this.facilityOperator) {
      try {
        const result = await this.provider.getBalance(this.facilityOperator.address)
        if (result != undefined) {
          if (result < BigInt(this.facilityOperatorMinEth)) {
            this.logger.error(`Balance depletion on facility operator: ${result} < ${this.facilityOperatorMinEth}`)
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
          if (result < BigInt(this.facilityContractMinToken)) {
            this.logger.error(`Balance depletion on facility token: ${result} < ${this.facilityContractMinToken}`)
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
}
