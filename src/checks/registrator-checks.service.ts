import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { BalancesData } from './schemas/balances-data'
import BigNumber from 'bignumber.js'
import { Wallet, ethers } from 'ethers'
import Bundlr from '@bundlr-network/client'

@Injectable()
export class RegistratorChecksService {
  private readonly logger = new Logger(RegistratorChecksService.name)

  private isLive?: string

  private registratorAddress: string | undefined

  private erc20Abi = ['function balanceOf(address owner) view returns (uint256)']
  private tokenAddress: string | undefined

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      JSON_RPC: string
      REGISTRATOR_CONTRACT_ADDRESS: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', {
      infer: true,
    })

    this.registratorAddress = this.config.get<string>('REGISTRATOR_CONTRACT_ADDRESS', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping facility checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)
    }
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
