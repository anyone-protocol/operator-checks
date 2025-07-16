import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class HodlerChecksService {
  private readonly logger = new Logger(HodlerChecksService.name)

  private isLive?: string

  private contractAddress: string | undefined
  private contract: ethers.Contract
  private contractMinToken: number
  private contractMaxToken: number

  private rewardsPoolAddress: string | undefined
  private rewardsPoolMinToken: number
  private rewardsPoolMaxToken: number

  private operator: ethers.Wallet
  private operatorAddress: string
  private operatorMinEth: number
  private operatorMaxEth: number

  private erc20Abi = ['function balanceOf(address owner) view returns (uint256)']
  private tokenAddress: string | undefined

  private jsonRpc: string | undefined
  private provider: ethers.JsonRpcProvider

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      HODLER_CONTRACT_ADDRESS: string
      HODLER_OPERATOR_KEY: string
      JSON_RPC: string
      HODLER_OPERATOR_MIN_ETH: number
      HODLER_OPERATOR_MAX_ETH: number
      HODLER_CONTRACT_MIN_TOKEN: number
      HODLER_CONTRACT_MAX_TOKEN: number
      REWARDS_POOL_ADDRESS: string
      REWARDS_POOL_MIN_TOKEN: number
      REWARDS_POOL_MAX_TOKEN: number
    }>
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', { infer: true })
    this.contractAddress = this.config.get<string>('HODLER_CONTRACT_ADDRESS', { infer: true })
    this.operatorMinEth = this.config.get<number>('HODLER_OPERATOR_MIN_ETH', { infer: true })
    this.operatorMaxEth = this.config.get<number>('HODLER_OPERATOR_MAX_ETH', { infer: true })
    this.contractMinToken = this.config.get<number>('HODLER_CONTRACT_MIN_TOKEN', { infer: true })
    this.contractMaxToken = this.config.get<number>('HODLER_CONTRACT_MAX_TOKEN', { infer: true })
    this.rewardsPoolAddress = this.config.get<string>('REWARDS_POOL_ADDRESS', { infer: true })
    this.rewardsPoolMinToken = this.config.get<number>('REWARDS_POOL_MIN_TOKEN', { infer: true })
    this.rewardsPoolMaxToken = this.config.get<number>('REWARDS_POOL_MAX_TOKEN', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping hodler checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)

      if (!this.tokenAddress) this.logger.error('Missing TOKEN_CONTRACT_ADDRESS. Skipping hodler checks...')
      else {
        this.contract = new ethers.Contract(this.tokenAddress, this.erc20Abi, this.provider)
      }

      const operatorKey = this.config.get<string>('HODLER_OPERATOR_KEY', { infer: true })
      if (!operatorKey) this.logger.error('Missing HODLER_OPERATOR_KEY. Skipping hodler checks...')
      else {
        this.operator = new ethers.Wallet(operatorKey, this.provider)
        this.operator.getAddress().then(address => {
          this.operatorAddress = address
          this.logger.log(
            `Initialized balance checks for hodler ${this.contractAddress} with operator ${
              address
            } and token: ${this.tokenAddress}`,
          )
        })

      }
    }
  }

  async getOperatorEth(): Promise<{
    balance: bigint
    address?: string
    requestAmount?: bigint
  }> {
    if (!this.operator) {
      this.logger.error('Hodler operator is undefined. Unable to check operator balance')
      return { balance: BigInt(0), address: this.operatorAddress }
    }

    try {
      const result = await this.provider.getBalance(this.operator.address)
      if (!result) {
        this.logger.error(`Failed to fetch hodler operator balance`)
        return { balance: BigInt(0), address: this.operatorAddress }
      }

      const minAmount = ethers.parseUnits(this.operatorMinEth.toString(), 18)
      const maxAmount = ethers.parseUnits(this.operatorMaxEth.toString(), 18)
      if (result < minAmount) {
        this.logger.warn(`Balance depletion on hodler operator: ${ethers.formatUnits(result, 18)} $ETH < ${ethers.formatUnits(minAmount, 18)} $ETH`)

        return {
          balance: result,
          requestAmount: maxAmount - result,
          address: this.operatorAddress
        }
      } else if (result > maxAmount) {
        this.logger.warn(`[alarm=balance-accumulation-eth-hodler] Balance accumulation on hodler operator: ${ethers.formatUnits(result, 18)} $ETH > ${ethers.formatUnits(minAmount, 18)} $ETH`)
      } else {
        this.logger.debug(`Checked operator eth ${ethers.formatUnits(result, 18)} vs min: ${ethers.formatUnits(minAmount, 18)}`)
      }

      return { balance: result, address: this.operatorAddress }
    } catch (error) {
      this.logger.error(`Exception while fetching hodler operator balance`, error.stack)
    }

    return { balance: BigInt(0), address: this.operatorAddress }
  }

  async getContractTokens(): Promise<{
    balance: bigint
    requestAmount?: bigint
    address?: string
  }> {
    if (!this.tokenAddress) {
      this.logger.error(
        'Token address not provided. Unable to check hodler token balance.'
      )
      return { balance: BigInt(0), address: this.contractAddress }
    }

    if (!this.contractAddress) {
      this.logger.error(
        'Contract address not provided. Unable to check hodler token balance.'
      )
      return { balance: BigInt(0), address: this.contractAddress }
    }

    try {
      const result = await this.contract.balanceOf(this.contractAddress)
      if (!result) {
        this.logger.error(`Failed to fetch hodler token balance`)
        return { balance: BigInt(0), address: this.contractAddress }
      }

      const minAmount = ethers.parseUnits(this.contractMinToken.toString(), 18)
      const maxAmount = ethers.parseUnits(this.contractMaxToken.toString(), 18)
      if (result < minAmount) {
        this.logger.warn(`Balance depletion on hodler token: ${ethers.formatUnits(result, 18)} $ANYONE < ${ethers.formatUnits(minAmount, 18)} $ANYONE`)
        
        return {
          balance: result,
          requestAmount: maxAmount - result,
          address: this.contractAddress
        }
      } else if (result > maxAmount) {
        this.logger.warn(`[alarm=balance-accumulation-anyonetokens-hodler] Balance accumulation on hodler token: ${ethers.formatUnits(result, 18)} $ANYONE > ${ethers.formatUnits(minAmount, 18)} $ANYONE`)
      } else {
        this.logger.log(`Checked contract tokens ${ethers.formatUnits(result, 18)} vs min: ${ethers.formatUnits(minAmount, 18)}`)
      }

      return { balance: result, address: this.contractAddress }
    } catch (error) {
      this.logger.error('Exception while fetching hodler token balance', error.stack)
    }

    return { balance: BigInt(0), address: this.contractAddress }
  }

  async getRewardsPoolTokens(): Promise<{
    balance: bigint
    requestAmount?: bigint
    address?: string
  }> {
    if (!this.rewardsPoolAddress) {
      this.logger.error('Rewards pool address not provided. Unable to check rewards pool token balance.')
      return { balance: BigInt(0), address: this.rewardsPoolAddress }
    }

    try {
      const result = await this.contract.balanceOf(this.rewardsPoolAddress!)
      if (!result) {
        this.logger.error(`Failed to fetch rewards pool token balance`)
        return { balance: BigInt(0), address: this.rewardsPoolAddress }
      }

      const minAmount = ethers.parseUnits(this.rewardsPoolMinToken.toString(), 18)
      const maxAmount = ethers.parseUnits(this.rewardsPoolMaxToken.toString(), 18)
      if (result < minAmount) {
        this.logger.warn(`Balance depletion on rewards pool token: ${ethers.formatUnits(result, 18)} $ANYONE < ${ethers.formatUnits(minAmount, 18)} $ANYONE`)

        return {
          balance: result,
          requestAmount: maxAmount - result,
          address: this.rewardsPoolAddress
        }
      } else if (result > maxAmount) {
        this.logger.warn(`[alarm=balance-accumulation-anyonetokens-rewards-pool] Balance accumulation on rewards pool token: ${ethers.formatUnits(result, 18)} $ANYONE > ${ethers.formatUnits(minAmount, 18)} $ANYONE`)
      } else {
        this.logger.log(`Checked rewards pool tokens ${ethers.formatUnits(result, 18)} vs min: ${ethers.formatUnits(minAmount, 18)}`)
      }

      return { balance: result, address: this.rewardsPoolAddress }
    } catch (error) {
      this.logger.error('Exception while fetching rewards pool token balance', error.stack)
    }

    return { balance: BigInt(0), address: this.rewardsPoolAddress }
  }
}
