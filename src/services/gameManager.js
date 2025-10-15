/**
 * Game Manager Service
 * Orchestrates the entire SmolPot game lifecycle with automated state transitions
 *
 * Lifecycle:
 * 1. IDLE → Start new game (set to BETTING phase)
 * 2. BETTING → Monitor timer, lock when expired
 * 3. LOCKED → Fetch EOS randomness, finish game
 * 4. COMPLETE → Record results, return to IDLE
 *
 * This service runs continuously with a cron job checking game state every second.
 */

const cron = require('node-cron');
const winston = require('winston');
const ContractService = require('./contractService');
const EosService = require('./eosService');
const SupabaseService = require('./supabaseService');

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

class GameManager {
  constructor() {
    if (GameManager.instance) {
      return GameManager.instance;
    }

    this.contractService = ContractService.getInstance();
    this.eosService = EosService.getInstance();
    this.supabaseService = SupabaseService.getInstance();

    this.cronJob = null;
    this.isProcessing = false; // Prevent concurrent executions
    this.isRunning = false;
    this.initialized = false;

    // Game phases enum (matches SmolPotCore.sol)
    this.GamePhase = {
      IDLE: 0,
      BETTING: 1,
      LOCKED: 2,
      COMPLETE: 3
    };

    GameManager.instance = this;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  /**
   * Initialize the game manager
   */
  async initialize() {
    if (this.initialized) {
      logger.info('Game Manager already initialized');
      return;
    }

    try {
      // Ensure all dependent services are initialized
      if (!this.contractService.isInitialized()) {
        await this.contractService.initialize();
      }

      if (!this.supabaseService.isInitialized()) {
        await this.supabaseService.initialize();
      }

      // EosService initializes in constructor

      logger.info('Game Manager initialized successfully');
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Game Manager', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Start the game manager cron job
   * Runs every second to monitor game state
   */
  start() {
    if (this.isRunning) {
      logger.warn('Game Manager already running');
      return;
    }

    if (!this.initialized) {
      throw new Error('Game Manager not initialized. Call initialize() first.');
    }

    logger.info('Starting Game Manager', {
      check_interval: process.env.GAME_CHECK_INTERVAL || '1 second'
    });

    // Run every second
    this.cronJob = cron.schedule('* * * * * *', async () => {
      await this.checkAndProcessGameState();
    });

    this.isRunning = true;
    logger.info('Game Manager started successfully');
  }

  /**
   * Stop the game manager
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('Game Manager not running');
      return;
    }

    logger.info('Stopping Game Manager');

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    this.isRunning = false;
    logger.info('Game Manager stopped successfully');
  }

  /**
   * Main game state checker - called every second by cron
   */
  async checkAndProcessGameState() {
    // Prevent concurrent executions
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const state = await this.contractService.getPotState();
      const currentPhase = parseInt(state.phase);

      logger.debug('Game state check', {
        potId: state.potId,
        phase: this.getPhaseLabel(currentPhase),
        totalAmount: state.totalAmount,
        tickets: state.tickets
      });

      // Process based on current phase
      switch (currentPhase) {
        case this.GamePhase.IDLE:
          await this.handleIdlePhase(state);
          break;

        case this.GamePhase.BETTING:
          await this.handleBettingPhase(state);
          break;

        case this.GamePhase.LOCKED:
          await this.handleLockedPhase(state);
          break;

        case this.GamePhase.COMPLETE:
          await this.handleCompletePhase(state);
          break;

        default:
          logger.error('Unknown game phase', { phase: currentPhase });
      }
    } catch (error) {
      logger.error('Error checking game state', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle IDLE phase - Start a new game
   */
  async handleIdlePhase(state) {
    logger.info('Game in IDLE phase - starting new round', {
      potId: state.potId
    });

    try {
      // Call startGame() on the contract
      const tx = await this.contractService.getContracts().smolPotCore.startGame();
      await tx.wait();

      logger.info('New game started successfully', {
        potId: state.potId,
        txHash: tx.hash
      });

      // Create game round record in database
      await this.createGameRound(state.potId);
    } catch (error) {
      logger.error('Failed to start new game', {
        error: error.message,
        potId: state.potId
      });
    }
  }

  /**
   * Handle BETTING phase - Check if timer expired
   */
  async handleBettingPhase(state) {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = parseInt(state.startTime);

      // Get timer duration from contract config (default 60 seconds)
      const timerDuration = parseInt(process.env.GAME_TIMER_DURATION || '60');
      const expiryTime = startTime + timerDuration;

      const timeRemaining = expiryTime - currentTime;

      // Log at 30s, 10s, 5s, 0s
      if ([30, 10, 5, 0].includes(timeRemaining)) {
        logger.info('Game timer update', {
          potId: state.potId,
          timeRemaining: timeRemaining + 's',
          totalAmount: state.totalAmount,
          tickets: state.tickets
        });
      }

      // Lock game when timer expires
      if (currentTime >= expiryTime) {
        logger.info('Game timer expired - locking game', {
          potId: state.potId,
          totalAmount: state.totalAmount,
          tickets: state.tickets,
          playerCount: state.playerCount
        });

        await this.lockGame(state);
      }
    } catch (error) {
      logger.error('Error handling betting phase', {
        error: error.message,
        potId: state.potId
      });
    }
  }

  /**
   * Handle LOCKED phase - Fetch EOS randomness and finish game
   */
  async handleLockedPhase(state) {
    logger.info('Game in LOCKED phase - fetching randomness', {
      potId: state.potId,
      totalAmount: state.totalAmount,
      tickets: state.tickets
    });

    try {
      // Check if we have tickets (at least one bet placed)
      if (parseInt(state.tickets) === 0) {
        logger.warn('No tickets sold - cancelling game', {
          potId: state.potId
        });

        // Emergency cancel if no bets
        const tx = await this.contractService.getContracts().smolPotCore.emergencyCancel();
        await tx.wait();

        logger.info('Game cancelled - no participants', {
          potId: state.potId,
          txHash: tx.hash
        });

        return;
      }

      // Fetch EOS block hash for randomness
      logger.info('Fetching EOS randomness', { potId: state.potId });
      const eosBlock = await this.eosService.getFutureBlockHash();

      logger.info('EOS randomness fetched', {
        potId: state.potId,
        blockNum: eosBlock.blockNum,
        blockHash: eosBlock.blockHash
      });

      // Finish game with EOS block hash
      await this.finishGame(state, eosBlock);
    } catch (error) {
      logger.error('Error handling locked phase', {
        error: error.message,
        potId: state.potId
      });
    }
  }

  /**
   * Handle COMPLETE phase - Record results and transition to IDLE
   */
  async handleCompletePhase(state) {
    logger.info('Game in COMPLETE phase - waiting for transition to IDLE', {
      potId: state.potId
    });

    // The contract automatically transitions to IDLE after payouts
    // We just log and wait for the next cycle
  }

  /**
   * Lock the game (prevent further bets)
   */
  async lockGame(state) {
    try {
      logger.info('Locking game', { potId: state.potId });

      const result = await this.contractService.lockGame();

      logger.info('Game locked successfully', {
        potId: state.potId,
        txHash: result.txHash,
        blockNumber: result.blockNumber
      });

      // Update game round in database
      await this.updateGameRound(state.potId, {
        phase: 'LOCKED',
        locked_at: new Date().toISOString(),
        lock_tx_hash: result.txHash
      });
    } catch (error) {
      logger.error('Failed to lock game', {
        error: error.message,
        potId: state.potId
      });
      throw error;
    }
  }

  /**
   * Finish the game with EOS randomness
   */
  async finishGame(state, eosBlock) {
    try {
      logger.info('Finishing game', {
        potId: state.potId,
        eosBlockNum: eosBlock.blockNum,
        eosBlockHash: eosBlock.blockHash
      });

      const result = await this.contractService.finishGame(eosBlock.blockHash);

      logger.info('Game finished successfully', {
        potId: state.potId,
        winner: result.winner,
        txHash: result.txHash,
        blockNumber: result.blockNumber
      });

      // Update game round with winner and EOS proof
      await this.updateGameRound(state.potId, {
        phase: 'COMPLETE',
        winner_address: result.winner,
        finished_at: new Date().toISOString(),
        finish_tx_hash: result.txHash,
        eos_block_number: eosBlock.blockNum,
        eos_block_hash: eosBlock.blockHash,
        eos_timestamp: eosBlock.timestamp
      });

      // Store EOS proof for verification
      await this.storeEosProof(state.potId, eosBlock);
    } catch (error) {
      logger.error('Failed to finish game', {
        error: error.message,
        potId: state.potId
      });
      throw error;
    }
  }

  /**
   * Create a new game round record in database
   */
  async createGameRound(potId) {
    try {
      const roundData = {
        pot_id: potId,
        phase: 'BETTING',
        started_at: new Date().toISOString(),
        total_amount: '0',
        total_tickets: 0,
        player_count: 0
      };

      await this.supabaseService.createGameRound(roundData);

      logger.info('Game round created in database', { potId });
    } catch (error) {
      logger.error('Failed to create game round', {
        error: error.message,
        potId
      });
    }
  }

  /**
   * Update game round in database
   */
  async updateGameRound(potId, updates) {
    try {
      await this.supabaseService.updateGameRoundByPotId(potId, updates);

      logger.debug('Game round updated in database', { potId, updates });
    } catch (error) {
      logger.error('Failed to update game round', {
        error: error.message,
        potId
      });
    }
  }

  /**
   * Store EOS proof for verification
   */
  async storeEosProof(potId, eosBlock) {
    try {
      const proofData = {
        pot_id: potId,
        eos_block_number: eosBlock.blockNum,
        eos_block_hash: eosBlock.blockHash,
        eos_timestamp: eosBlock.timestamp,
        eos_producer: eosBlock.producer,
        fetched_at: new Date().toISOString()
      };

      await this.supabaseService.createEosProof(proofData);

      logger.info('EOS proof stored for verification', {
        potId,
        blockNum: eosBlock.blockNum
      });
    } catch (error) {
      logger.error('Failed to store EOS proof', {
        error: error.message,
        potId
      });
    }
  }

  /**
   * Get human-readable phase label
   */
  getPhaseLabel(phase) {
    const labels = {
      [this.GamePhase.IDLE]: 'IDLE',
      [this.GamePhase.BETTING]: 'BETTING',
      [this.GamePhase.LOCKED]: 'LOCKED',
      [this.GamePhase.COMPLETE]: 'COMPLETE'
    };
    return labels[phase] || 'UNKNOWN';
  }

  /**
   * Check if the manager is running
   */
  isManagerRunning() {
    return this.isRunning;
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized() {
    return this.initialized;
  }
}

module.exports = GameManager;
