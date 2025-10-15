/**
 * Treasury Wallet Service
 * Manages the server-side wallet used as the approved operator for SmolPot transactions
 *
 * Security: This service holds the private key for the Treasury Wallet.
 * NEVER expose the private key or wallet instance to the frontend.
 */

const { ethers } = require('ethers');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class WalletService {
  constructor() {
    if (WalletService.instance) {
      return WalletService.instance;
    }

    this.provider = null;
    this.treasuryWallet = null;
    this.initialized = false;

    WalletService.instance = this;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  /**
   * Initialize the wallet service
   * Must be called before using any wallet methods
   */
  async initialize() {
    if (this.initialized) {
      logger.info('WalletService already initialized');
      return;
    }

    try {
      // Validate environment variables
      const rpcUrl = process.env.ABSTRACT_RPC_URL;
      const privateKey = process.env.TREASURY_WALLET_PRIVATE_KEY;
      const chainId = parseInt(process.env.ABSTRACT_CHAIN_ID || '11124');

      if (!rpcUrl) {
        throw new Error('ABSTRACT_RPC_URL environment variable is required');
      }

      if (!privateKey || privateKey === 'GENERATE_NEW_WALLET_AND_REPLACE_THIS') {
        throw new Error(
          'TREASURY_WALLET_PRIVATE_KEY must be set with a valid private key. ' +
          'Generate one using: node -e "console.log(require(\'ethers\').Wallet.createRandom())"'
        );
      }

      // Create provider
      this.provider = new ethers.JsonRpcProvider(rpcUrl, {
        chainId,
        name: 'Abstract Testnet'
      });

      // Create wallet from private key
      this.treasuryWallet = new ethers.Wallet(privateKey, this.provider);

      // Verify connection and wallet
      const network = await this.provider.getNetwork();
      const balance = await this.provider.getBalance(this.treasuryWallet.address);

      logger.info('Treasury Wallet Service initialized successfully', {
        address: this.treasuryWallet.address,
        chainId: network.chainId.toString(),
        balance: ethers.formatEther(balance) + ' ETH'
      });

      // Warn if balance is low
      const balanceInEth = parseFloat(ethers.formatEther(balance));
      if (balanceInEth < 0.01) {
        logger.warn('Treasury Wallet has low balance! Please fund it.', {
          address: this.treasuryWallet.address,
          balance: balanceInEth + ' ETH'
        });
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Treasury Wallet Service', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get the Treasury Wallet instance
   * @returns {ethers.Wallet}
   */
  getTreasuryWallet() {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }
    return this.treasuryWallet;
  }

  /**
   * Get the Treasury Wallet address
   * @returns {string}
   */
  getTreasuryAddress() {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }
    return this.treasuryWallet.address;
  }

  /**
   * Get the provider instance
   * @returns {ethers.JsonRpcProvider}
   */
  getProvider() {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }
    return this.provider;
  }

  /**
   * Get the current balance of the Treasury Wallet
   * @returns {Promise<string>} Balance in ETH
   */
  async getBalance() {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }

    try {
      const balance = await this.provider.getBalance(this.treasuryWallet.address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error('Failed to get Treasury Wallet balance', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Sign a message with the Treasury Wallet
   * @param {string} message - Message to sign
   * @returns {Promise<string>} Signature
   */
  async signMessage(message) {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }

    try {
      const signature = await this.treasuryWallet.signMessage(message);
      logger.debug('Message signed successfully', {
        message: message.substring(0, 50) + '...'
      });
      return signature;
    } catch (error) {
      logger.error('Failed to sign message', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Sign a transaction with the Treasury Wallet
   * @param {object} transaction - Transaction object
   * @returns {Promise<string>} Signed transaction
   */
  async signTransaction(transaction) {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }

    try {
      const signedTx = await this.treasuryWallet.signTransaction(transaction);
      logger.debug('Transaction signed successfully', {
        to: transaction.to,
        value: transaction.value ? ethers.formatEther(transaction.value) : '0'
      });
      return signedTx;
    } catch (error) {
      logger.error('Failed to sign transaction', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get the current gas price
   * @returns {Promise<bigint>} Gas price in wei
   */
  async getGasPrice() {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }

    try {
      const feeData = await this.provider.getFeeData();
      return feeData.gasPrice;
    } catch (error) {
      logger.error('Failed to get gas price', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Estimate gas for a transaction
   * @param {object} transaction - Transaction object
   * @returns {Promise<bigint>} Estimated gas
   */
  async estimateGas(transaction) {
    if (!this.initialized) {
      throw new Error('WalletService not initialized. Call initialize() first.');
    }

    try {
      const gasEstimate = await this.provider.estimateGas(transaction);
      return gasEstimate;
    } catch (error) {
      logger.error('Failed to estimate gas', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if the wallet service is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }
}

module.exports = WalletService;
