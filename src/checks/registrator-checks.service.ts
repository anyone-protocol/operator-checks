import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class RegistratorChecksService {
  private readonly logger = new Logger(RegistratorChecksService.name)

  private isLive?: string

  private contractAddress: string | undefined
  private contract: ethers.Contract

  private erc20Abi = ['function balanceOf(address owner) view returns (uint256)']
  private tokenAddress: string | undefined

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      JSON_RPC: string
      TOKEN_CONTRACT_ADDRESS: string
      REGISTRATOR_CONTRACT_ADDRESS: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })

    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', {
      infer: true,
    })

    this.contractAddress = this.config.get<string>('REGISTRATOR_CONTRACT_ADDRESS', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping facility checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)

      if (!this.tokenAddress) this.logger.error('Missing TOKEN_CONTRACT_ADDRESS. Skipping facility checks...')
      else {
        this.contract = new ethers.Contract(this.tokenAddress, this.erc20Abi, this.provider)
      }
    }
  }

  async getContractTokens(): Promise<{
    balance: bigint
    requestAmount?: bigint
    address?: string
  }> {
    if (!this.tokenAddress) {
      this.logger.error('Token address not provided. Unable to check registrator token balance.')
      return { balance: BigInt(0) }
    }

    try {
      const result = await this.contract.balanceOf(this.contractAddress!)
      if (!result) {
        this.logger.error(`Failed to fetch registrator token balance`)
        return { balance: BigInt(0) }
      }

      this.logger.log(`Checked contract tokens ${ethers.formatUnits(result, 18)}`)

      return { balance: result }
    } catch (error) {
      this.logger.error('Exception while fetching registrator token balance', error.stack)
    }

    return { balance: BigInt(0) }
  }
}
