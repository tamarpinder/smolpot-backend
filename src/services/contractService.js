/**
 * Contract Service
 * Handles all interactions with SmolPot smart contracts on Abstract testnet
 *
 * This service wraps ethers.js contract interactions and provides
 * a clean API for the backend to interact with:
 * - SmolPotCore (main game logic)
 * - SMOL Token (ERC20)
 */

const { ethers } = require('ethers');
const winston = require('winston');
const WalletService = require('./walletService');
const { SmolPotCoreABI, SmolTokenABI } = require('../abis');

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

class ContractService {
  constructor() {
    if (ContractService.instance) {
      return ContractService.instance;
    }

    this.walletService = WalletService.getInstance();
    this.smolPotCore = null;
    this.smolToken = null;
    this.initialized = false;

    ContractService.instance = this;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!ContractService.instance) {
      ContractService.instance = new ContractService();
    }
    return ContractService.instance;
  }

  /**
   * Initialize the contract service
   */
  async initialize() {
    if (this.initialized) {
      logger.info('ContractService already initialized');
      return;
    }

    try {
      // Ensure WalletService is initialized
      if (!this.walletService.isInitialized()) {
        await this.walletService.initialize();
      }

      // Get contract addresses from env
      const coreAddress = process.env.SMOLPOT_CORE_CONTRACT_ADDRESS;
      const tokenAddress = process.env.SMOL_TOKEN_CONTRACT_ADDRESS;

      if (!coreAddress) {
        throw new Error('SMOLPOT_CORE_CONTRACT_ADDRESS environment variable is required');
      }
      if (!tokenAddress) {
        throw new Error('SMOL_TOKEN_CONTRACT_ADDRESS environment variable is required');
      }

      // Create contract instances with Treasury Wallet as signer
      const treasuryWallet = this.walletService.getTreasuryWallet();

      this.smolPotCore = new ethers.Contract(
        coreAddress,
        SmolPotCoreABI,
        treasuryWallet
      );

      this.smolToken = new ethers.Contract(
        tokenAddress,
        SmolTokenABI,
        treasuryWallet
      );

      logger.info('Contract Service initialized successfully', {
        smolPotCore: coreAddress,
        smolToken: tokenAddress,
        operator: treasuryWallet.address
      });

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Contract Service', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get the current game state
   * @returns {Promise<object>}
   */
  async getPotState() {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }

    try {
      const state = await this.smolPotCore.getCurrentGameState();
      return {
        potId: state.potId.toString(),
        phase: state.phase, // 0=IDLE, 1=BETTING, 2=LOCKED, 3=COMPLETE
        startTime: state.startTime.toString(),
        totalAmount: state.totalAmount.toString(),
        tickets: state.tickets.toString(),
        playerCount: state.playerCount.toString()
      };
    } catch (error) {
      logger.error('Failed to get pot state', { error: error.message });
      throw error;
    }
  }

  /**
   * Enter the pot on behalf of a player (operator model)
   * The player must have already approved the SmolPotCore contract to spend their SMOL tokens
   *
   * @param {string} playerAddress - Address of the player
   * @param {string} amount - Amount in SMOL tokens (as string to preserve precision)
   * @returns {Promise<object>} Transaction receipt
   */
  async enterPotFor(playerAddress, amount) {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }

    try {
      // Validate inputs
      if (!ethers.isAddress(playerAddress)) {
        throw new Error('Invalid player address');
      }

      const amountBigInt = ethers.parseUnits(amount, 18); // SMOL has 18 decimals

      if (amountBigInt <= 0n) {
        throw new Error('Amount must be greater than 0');
      }

      // Check if amount is within limits
      const minBet = ethers.parseUnits(process.env.MIN_BET_AMOUNT || '1', 18);
      const maxBet = ethers.parseUnits(process.env.MAX_BET_AMOUNT || '1000000', 18);

      if (amountBigInt < minBet) {
        throw new Error(`Bet amount below minimum: ${process.env.MIN_BET_AMOUNT} SMOL`);
      }
      if (amountBigInt > maxBet) {
        throw new Error(`Bet amount exceeds maximum: ${process.env.MAX_BET_AMOUNT} SMOL`);
      }

      // Check player's SMOL token balance
      const balance = await this.smolToken.balanceOf(playerAddress);
      if (balance < amountBigInt) {
        throw new Error('Player has insufficient SMOL token balance');
      }

      // Check player's allowance for SmolPotCore contract
      const allowance = await this.smolToken.allowance(
        playerAddress,
        await this.smolPotCore.getAddress()
      );

      if (allowance < amountBigInt) {
        throw new Error(
          'Player has not approved sufficient SMOL tokens. ' +
          'Player must call approve() on SMOL token contract first.'
        );
      }

      logger.info('Entering pot for player', {
        player: playerAddress,
        amount: ethers.formatUnits(amountBigInt, 18) + ' SMOL'
      });

      // Call enterPotFor on the contract
      const tx = await this.smolPotCore.enterPotFor(playerAddress, amountBigInt);

      logger.info('Transaction submitted', {
        txHash: tx.hash,
        player: playerAddress
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      logger.info('Transaction confirmed', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error('Failed to enter pot', {
        error: error.message,
        player: playerAddress,
        amount
      });
      throw error;
    }
  }

  /**
   * Lock the game (prevent further bets)
   * Only callable by approved operator
   * @returns {Promise<object>} Transaction receipt
   */
  async lockGame() {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }

    try {
      logger.info('Locking game');

      const tx = await this.smolPotCore.lockGame();
      const receipt = await tx.wait();

      logger.info('Game locked successfully', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      });

      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (error) {
      logger.error('Failed to lock game', { error: error.message });
      throw error;
    }
  }

  /**
   * Finish the game and select winner using EOS block hash
   * Only callable by approved operator
   *
   * @param {string} eosBlockHash - The EOS block hash to use for randomness
   * @returns {Promise<object>} Transaction receipt with winner info
   */
  async finishGame(eosBlockHash) {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }

    try {
      // Validate block hash format
      if (!/^0x[0-9a-fA-F]{64}$/.test(eosBlockHash)) {
        throw new Error('Invalid EOS block hash format');
      }

      logger.info('Finishing game with EOS block hash', {
        blockHash: eosBlockHash
      });

      const tx = await this.smolPotCore.finishGame(eosBlockHash);
      const receipt = await tx.wait();

      // Extract winner from GameFinished event
      const gameFinishedEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'GameFinished'
      );

      let winner = null;
      if (gameFinishedEvent) {
        winner = gameFinishedEvent.args.winner;
      }

      logger.info('Game finished successfully', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        winner
      });

      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        winner
      };
    } catch (error) {
      logger.error('Failed to finish game', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if an address is an approved operator
   * @param {string} operatorAddress
   * @returns {Promise<boolean>}
   */
  async isApprovedOperator(operatorAddress) {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }

    try {
      return await this.smolPotCore.isApprovedOperator(operatorAddress);
    } catch (error) {
      logger.error('Failed to check operator approval', { error: error.message });
      throw error;
    }
  }

  /**
   * Get SMOL token balance for an address
   * @param {string} address
   * @returns {Promise<string>} Balance in SMOL (formatted)
   */
  async getSmolBalance(address) {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }

    try {
      const balance = await this.smolToken.balanceOf(address);
      return ethers.formatUnits(balance, 18);
    } catch (error) {
      logger.error('Failed to get SMOL balance', { error: error.message });
      throw error;
    }
  }

  /**
   * Get contract instances (for advanced usage)
   */
  getContracts() {
    if (!this.initialized) {
      throw new Error('ContractService not initialized. Call initialize() first.');
    }
    return {
      smolPotCore: this.smolPotCore,
      smolToken: this.smolToken
    };
  }

  /**
   * Check if the service is initialized
   */
  isInitialized() {
    return this.initialized;
  }
}

module.exports = ContractService;
