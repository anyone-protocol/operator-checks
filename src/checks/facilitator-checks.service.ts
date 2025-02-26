import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class FacilitatorChecksService {
  private readonly logger = new Logger(FacilitatorChecksService.name)

  private isLive?: string

  private contractAddress: string | undefined
  private contract: ethers.Contract
  private contractMinToken: number
  private contractMaxToken: number

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
      FACILITY_CONTRACT_ADDRESS: string
      FACILITY_OPERATOR_KEY: string
      JSON_RPC: string
      FACILITY_OPERATOR_MIN_ETH: number
      FACILITY_OPERATOR_MAX_ETH: number
      FACILITY_CONTRACT_MIN_TOKEN: number
      FACILITY_CONTRACT_MAX_TOKEN: number
    }>
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', { infer: true })
    this.contractAddress = this.config.get<string>('FACILITY_CONTRACT_ADDRESS', { infer: true })
    this.operatorMinEth = this.config.get<number>('FACILITY_OPERATOR_MIN_ETH', { infer: true })
    this.operatorMaxEth = this.config.get<number>('FACILITY_OPERATOR_MAX_ETH', { infer: true })
    this.contractMinToken = this.config.get<number>('FACILITY_CONTRACT_MIN_TOKEN', { infer: true })
    this.contractMaxToken = this.config.get<number>('FACILITY_CONTRACT_MAX_TOKEN', { infer: true })

    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    if (this.jsonRpc == undefined) {
      this.logger.error('Missing JSON_RPC. Skipping facilitator checks')
    } else {
      this.provider = new ethers.JsonRpcProvider(this.jsonRpc)

      if (!this.tokenAddress) this.logger.error('Missing TOKEN_CONTRACT_ADDRESS. Skipping facility checks...')
      else {
        this.contract = new ethers.Contract(this.tokenAddress, this.erc20Abi, this.provider)
      }

      const operatorKey = this.config.get<string>('FACILITY_OPERATOR_KEY', { infer: true })
      if (!operatorKey) this.logger.error('Missing FACILITY_OPERATOR_KEY. Skipping facility checks...')
      else {
        this.operator = new ethers.Wallet(operatorKey, this.provider)
        this.operator.getAddress().then(address => {
          this.operatorAddress = address
          this.logger.log(
            `Initialized balance checks for facility ${this.contractAddress} with operator ${
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
      this.logger.error('Facility operator is undefined. Unable to check operator balance')
      return { balance: BigInt(0), address: this.operatorAddress }
    }

    try {
      const result = await this.provider.getBalance(this.operator.address)
      if (!result) {
        this.logger.error(`Failed to fetch facility operator balance`)
        return { balance: BigInt(0), address: this.operatorAddress }
      }

      const minAmount = ethers.parseUnits(this.operatorMinEth.toString(), 18)
      const maxAmount = ethers.parseUnits(this.operatorMaxEth.toString(), 18)
      if (result < minAmount) {
        this.logger.warn(`Balance depletion on facility operator: ${ethers.formatUnits(result, 18)} $ETH < ${ethers.formatUnits(minAmount, 18)} $ETH`)

        return {
          balance: result,
          requestAmount: maxAmount - result,
          address: this.operatorAddress
        }
      } else if (result > maxAmount) {
        this.logger.warn(`[alarm=balance-accumulation-eth-facility] Balance accumulation on facility operator: ${ethers.formatUnits(result, 18)} $ETH > ${ethers.formatUnits(minAmount, 18)} $ETH`)
      } else {
        this.logger.debug(`Checked operator eth ${ethers.formatUnits(result, 18)} vs min: ${ethers.formatUnits(minAmount, 18)}`)
      }

      return { balance: result, address: this.operatorAddress }
    } catch (error) {
      this.logger.error(`Exception while fetching facility operator balance`, error.stack)
    }

    return { balance: BigInt(0), address: this.operatorAddress }
  }

  async getContractTokens(): Promise<{
    balance: bigint
    requestAmount?: bigint
    address?: string
  }> {
    if (!this.tokenAddress) {
      this.logger.error('Token address not provided. Unable to check facility token balance.')
      return { balance: BigInt(0), address: this.contractAddress }
    }

    try {
      const result = await this.contract.balanceOf(this.contractAddress!)
      if (!result) {
        this.logger.error(`Failed to fetch facility token balance`)
        return { balance: BigInt(0), address: this.contractAddress }
      }

      const minAmount = ethers.parseUnits(this.contractMinToken.toString(), 18)
      const maxAmount = ethers.parseUnits(this.contractMaxToken.toString(), 18)
      if (result < minAmount) {
        this.logger.warn(`Balance depletion on facility token: ${ethers.formatUnits(result, 18)} $ANYONE < ${ethers.formatUnits(minAmount, 18)} $ANYONE`)
        
        return {
          balance: result,
          requestAmount: maxAmount - result,
          address: this.contractAddress
        }
      } else if (result > maxAmount) {
        this.logger.warn(`[alarm=balance-accumulation-anyonetokens-facility] Balance accumulation on facility token: ${ethers.formatUnits(result, 18)} $ANYONE > ${ethers.formatUnits(minAmount, 18)} $ANYONE`)
      } else {
        this.logger.log(`Checked contract tokens ${ethers.formatUnits(result, 18)} vs min: ${ethers.formatUnits(minAmount, 18)}`)
      }

      return { balance: result, address: this.contractAddress }
    } catch (error) {
      this.logger.error('Exception while fetching facility token balance', error.stack)
    }

    return { balance: BigInt(0), address: this.contractAddress }
  }
}
