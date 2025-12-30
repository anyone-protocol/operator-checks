import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Arweave from 'arweave'
import { JWKInterface } from 'arweave/node/lib/wallet'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { TurboFactory, ArweaveSigner, WinstonToTokenAmount } from '@ardrive/turbo-sdk'

@Injectable()
export class RefillsService {
  private readonly logger = new Logger(RefillsService.name)

  private isLive?: string
  private jsonRpc?: string
  private tokenAddress?: string
  private ethSpender: ethers.Wallet
  private ethSpenderAddress: string
  private provider: ethers.JsonRpcProvider 
  private tokenContract: ethers.Contract
  private erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)']
  private arweave: Arweave
  private arSpender: JWKInterface
  private arSpenderAddress: string

  constructor(
    private readonly config: ConfigService<{
      IS_LIVE: string
      TOKEN_CONTRACT_ADDRESS: string
      JSON_RPC: string
      ETH_SPENDER_KEY: string
      AR_SPENDER_KEY: string
      ARWEAVE_GATEWAY_PROTOCOL: string
      ARWEAVE_GATEWAY_HOST: string
      ARWEAVE_GATEWAY_PORT: number
    }>,
  ) {
    this.isLive = this.config.get<string>('IS_LIVE', { infer: true })
    this.jsonRpc = this.config.get<string>('JSON_RPC', { infer: true })
    this.tokenAddress = this.config.get<string>('TOKEN_CONTRACT_ADDRESS', { infer: true })
    const ethSpenderKey = this.config.get<string>('ETH_SPENDER_KEY', { infer: true })
    this.provider = new ethers.JsonRpcProvider(this.jsonRpc)
    if (!ethSpenderKey) {
      throw new Error('Missing ETH_SPENDER_KEY')
    }
    this.ethSpender = new ethers.Wallet(
      ethSpenderKey!,
      this.provider
    )
    this.tokenContract = new ethers.Contract(this.tokenAddress!, this.erc20Abi, this.ethSpender)
    const arSpenderKey = this.config.get<string>('AR_SPENDER_KEY', { infer: true })
    if (!arSpenderKey) {
      throw new Error('Missing AR_SPENDER_KEY')
    }
    try {
      this.arSpender = JSON.parse(arSpenderKey)
    } catch (error) {
      throw new Error('Failed to parse AR_SPENDER_KEY')
    }
    
    const arweaveConfig = {
      host: this.config.get<string>('ARWEAVE_GATEWAY_HOST', { infer: true }) || 'arweave.net',
      port: this.config.get<number>('ARWEAVE_GATEWAY_PORT', { infer: true }) || 443,
      protocol: this.config.get<string>('ARWEAVE_GATEWAY_PROTOCOL', { infer: true }) || 'https'
    }
    this.arweave = Arweave.init(arweaveConfig)
    try {
      this.arweave.wallets.jwkToAddress(this.arSpender).then(address => {
        this.arSpenderAddress = address
        this.logger.log(`Initialized refills service with arSpender [${address}]`)
      })
    } catch (error) {
      this.logger.error('Failed to initialize refills service with arSpender', error.stack)
    }
    this.ethSpender.getAddress().then(address => {
      this.ethSpenderAddress = address
      this.logger.log(`Initialized refills service with ethSpender [${address}]`)
    })
  }

  async sendEthTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        const tx = await this.ethSpender.sendTransaction({
          to: address,
          value: ethers.parseEther(amount)
        })
        await tx.wait()
        this.logger.log(
          `EthSpender [${this.ethSpenderAddress}] finished sending [${amount}] $ETH to [${address}] with tx [${tx.hash}]`
        )
      } else {
        this.logger.warn(
          `NOT LIVE, EthSpender [${this.ethSpenderAddress}] did NOT send [${amount}] $ETH to [${address}]`
        )
      }
      
      return true
    } catch (error) {
      this.logger.error(`[alarm=refill-failed-eth] Failed to send ${amount} $ETH to ${address}`, error.stack)
      return false
    }
  }

  async sendTokensTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        const tx = await this.tokenContract.transfer(address, amount)
        await tx.wait()
        this.logger.log(
          `EthSpender [${this.ethSpenderAddress}] finished sending [${ethers.formatUnits(amount, 18)}] tokens to [${address}] with tx [${tx.hash}]`
        )
      } else {
        this.logger.warn(
          `NOT LIVE, EthSpender [${this.ethSpenderAddress}] did NOT send [${ethers.formatUnits(amount, 18)}] tokens to [${address}]`
        )
      }
      
      return true
    } catch (error) {
      this.logger.error(`[alarm=refill-failed-anyonetokens] EthSpender [${this.ethSpenderAddress}] failed to send [${ethers.formatUnits(amount, 18)}] tokens to [${address}]`, error.stack)
      return false
    }
  }

  async sendArTo(address: string, amount: string): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        const arSpenderBalanceWinston = await this.arweave.wallets.getBalance(this.arSpenderAddress)
        const arSpenderBalance = this.arweave.ar.winstonToAr(arSpenderBalanceWinston)
        if (BigNumber(arSpenderBalance).lt(BigNumber(amount))) {
          this.logger.warn(
            `[alarm=refill-failed-ar] ArSpender [${this.arSpenderAddress}] does not have enough balance [${arSpenderBalance}] $AR to send [${amount}] $AR to [${address}]`
          )
          return false
        }

        const tx = await this.arweave.createTransaction({
          target: address,
          quantity: this.arweave.ar.arToWinston(amount)
        }, this.arSpender)
        await this.arweave.transactions.sign(tx, this.arSpender)
        const response = await this.arweave.transactions.post(tx)

        if (response.status === 200) {
          this.logger.log(
            `ArSpender [${this.arSpenderAddress}] finished sending [${amount}] $AR to [${address}] with tx [${tx.id}]`
          )

          return true
        }

        this.logger.warn(
          `[alarm=refill-failed-ar] Failed to send [${amount}] $AR to [${address}]: ${JSON.stringify(response)}`
        )

        return false
      } else { 
        this.logger.warn(
          `NOT LIVE, ArSpender [${this.arSpenderAddress}] did NOT send [${amount}] $AR to [${address}].`
        )
      }
      
      return true
    } catch (error) {
      this.logger.error(`Failed to send [${amount}] $AR to [${address}]`, error.stack)
      return false
    }
  }
  
  async sendAoTo(address: string, amount: string): Promise<boolean> {
    try {
      this.logger.warn('sendAoTo - Not implemented yet')
      
      return true
    } catch (error) {
      this.logger.error(`[alarm=refill-failed-ao] Failed to send [${amount}] $AO to [${address}]`, error.stack)
      return false
    }
  }

  async topUpTurboCredits(address: string, credits: BigNumber): Promise<boolean> {
    try {
      if (this.isLive == 'true') {
        // Check AR spender balance first
        const arSpenderBalanceWinston = await this.arweave.wallets.getBalance(this.arSpenderAddress)
        const arSpenderBalance = this.arweave.ar.winstonToAr(arSpenderBalanceWinston)
        
        this.logger.log(
          `Attempting to top up Turbo credits for [${address}] with ${credits.toFixed(6)} Credits. ArSpender balance: ${arSpenderBalance} $AR`
        )

        // Create authenticated Turbo client with AR spender
        const signer = new ArweaveSigner(this.arSpender)
        const turbo = TurboFactory.authenticated({ signer })

        // Convert credits to winc (Winston Credits: 1 Credit = 1e12 winc)
        const wincAmount = credits.multipliedBy(1e12).integerValue(BigNumber.ROUND_CEIL)
        
        // Get the required AR amount for the winc
        const { actualTokenAmount } = await turbo.getWincForToken({
          tokenAmount: WinstonToTokenAmount(wincAmount.toString())
        })

        const arRequired = this.arweave.ar.winstonToAr(actualTokenAmount.toString())
        
        if (BigNumber(arSpenderBalance).lt(BigNumber(arRequired))) {
          this.logger.warn(
            `[alarm=refill-failed-turbo-credits] ArSpender [${this.arSpenderAddress}] does not have enough balance [${arSpenderBalance}] $AR to top up [${credits.toFixed(6)}] Credits (requires ~${arRequired} $AR) for [${address}]`
          )
          return false
        }

        // Top up with AR tokens, specifying the destination address
        const { winc, status, id } = await turbo.topUpWithTokens({
          tokenAmount: WinstonToTokenAmount(actualTokenAmount.toString()),
          turboCreditDestinationAddress: address,
        })

        if (status === 'confirmed' || status === 'pending') {
          const creditsAdded = BigNumber(winc).dividedBy(1e12)
          this.logger.log(
            `ArSpender [${this.arSpenderAddress}] successfully topped up [${creditsAdded.toFixed(6)}] Credits to [${address}] with tx [${id}] (status: ${status})`
          )
          return true
        } else {
          this.logger.warn(
            `[alarm=refill-failed-turbo-credits] Failed to top up Turbo credits for [${address}]: status ${status}, tx [${id}]`
          )
          return false
        }
      } else {
        this.logger.warn(
          `NOT LIVE, ArSpender [${this.arSpenderAddress}] did NOT top up [${credits.toFixed(6)}] Credits to [${address}]`
        )
      }
      
      return true
    } catch (error) {
      this.logger.error(
        `[alarm=refill-failed-turbo-credits] Failed to top up [${credits.toFixed(6)}] Credits for [${address}]`,
        error.stack
      )
      return false
    }
  }
}
