import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class RefillsService {
  private readonly logger = new Logger(RefillsService.name)

  private isLive?: string
  private jsonRpc?: string
  private tokenAddress?: string

  private ethSpender: ethers.Wallet
  private provider: ethers.JsonRpcProvider 
  private tokenContract: ethers.Contract

  private erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      JSON_RPC: string
      BUNDLER_NODE: string
      BUNDLER_NETWORK: string
      ETH_SPENDER_KEY: string
      AR_SPENDER_KEY: string
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', { infer: true })

    const ethSpenderKey = this.config.get<string>('ETH_SPENDER_KEY', { infer: true })

    this.provider = new ethers.JsonRpcProvider(this.jsonRpc)

    this.ethSpender = new ethers.Wallet(
      ethSpenderKey!,
      this.provider,
    )

    this.tokenContract = new ethers.Contract(this.tokenAddress!, this.erc20Abi, this.ethSpender)
    
    const arSpenderKey = this.config.get<string>('AR_SPENDER_KEY', { infer: true })

    this.logger.log(`Initialized refills service with ethSpender ${this.ethSpender.address}, arSpender ${this}`)
  }

  async sendEthTo(address: string, amount: string): Promise<boolean> {
    try {
      this.logger.warn('sendEthTo - Not implemented yet')
      
      return true
    } catch (error) {
      this.logger.error(`Failed to send ${amount} ETH to ${address}`, error.stack)
      return false
    }
  }

  async sendTokensTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        const tx = await this.tokenContract.transfer(address, ethers.parseUnits(amount, 18))
        await tx.wait()
        this.logger.log(`Finished sending ${amount} tokens to ${address}. Tx: ${tx}`)
      } else {
        this.logger.warn(`NOT LIVE, Finished sending ${amount} tokens to ${address}.`)
      }
      
      return true
    } catch (error) {
      this.logger.error(`Failed to send ${amount} tokens to ${address}`, error.stack)
      return false
    }
  }

  async sendArTo(address: string, amount: string): Promise<boolean> {
    try {
      this.logger.warn('sendArTo - Not implemented yet')
      
      return true
    } catch (error) {
      this.logger.error(`Failed to send ${amount} AR to ${address}`, error.stack)
      return false
    }
  }
  
  async fundUploader(address: string, amount: string): Promise<boolean> {
    try {
      this.logger.warn('fundUploader - Not implemented yet')
      
      return true
    } catch (error) {
      this.logger.error(`Failed to fund the uploader by ${amount} for ${address}`, error.stack)
      return false
    }
  }
}
