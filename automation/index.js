#!/usr/bin/env node

const { ethers } = require('ethers');
const winston = require('winston');
const cron = require('node-cron');
require('dotenv').config();

// Import configuration and utilities
const { CONTRACT_CONFIG, WORKER_CONFIG, MONITORING_CONFIG } = require('./config');
const { NotificationService } = require('./services/notifications');
const { BalanceMonitor } = require('./services/balance-monitor');
const { ContractMonitor } = require('./services/contract-monitor');
const { HealthCheckServer } = require('./health-server');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'smolpot-automation' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class SmolPotAutomation {
  constructor() {
    this.provider = null;
    this.workerWallet = null;
    this.contract = null;
    this.notificationService = null;
    this.balanceMonitor = null;
    this.contractMonitor = null;
    this.healthCheckServer = null;
    this.isRunning = false;
    this.stats = {
      monitored: 0,
      winnersDrawn: 0,
      errors: 0,
      lastActivity: null,
      uptime: Date.now()
    };
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing SmolPot Automation Service...');
      
      // Validate environment
      this.validateEnvironment();
      
      // Initialize blockchain connection
      await this.initializeBlockchain();
      
      // Initialize services
      await this.initializeServices();
      
      // Set up error handlers
      this.setupErrorHandlers();
      
      logger.info('✅ SmolPot Automation Service initialized successfully');
      
      // Send startup notification
      await this.notificationService.sendStartup({
        workerAddress: this.workerWallet.address,
        balance: await this.getWorkerBalance(),
        networkName: CONTRACT_CONFIG.NETWORK_NAME
      });
      
    } catch (error) {
      logger.error('❌ Failed to initialize automation service', error);
      process.exit(1);
    }
  }

  validateEnvironment() {
    const required = [
      'WORKER_PRIVATE_KEY',
      'RPC_URL',
      'CONTRACT_ADDRESS',
      'MIN_WORKER_BALANCE'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate private key format
    if (!process.env.WORKER_PRIVATE_KEY.startsWith('0x')) {
      throw new Error('WORKER_PRIVATE_KEY must start with 0x');
    }
    
    logger.info('✅ Environment validation passed');
  }

  async initializeBlockchain() {
    try {
      // Create provider
      this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      
      // Test connection
      const network = await this.provider.getNetwork();
      logger.info(`🌐 Connected to ${CONTRACT_CONFIG.NETWORK_NAME} (Chain ID: ${network.chainId})`);
      
      // Initialize worker wallet
      this.workerWallet = new ethers.Wallet(process.env.WORKER_PRIVATE_KEY, this.provider);
      logger.info(`👤 Worker wallet: ${this.workerWallet.address}`);
      
      // Check worker balance
      const balance = await this.getWorkerBalance();
      logger.info(`💰 Worker balance: ${ethers.formatEther(balance)} ETH`);
      
      if (balance < ethers.parseEther(process.env.MIN_WORKER_BALANCE)) {
        throw new Error(`Worker balance too low: ${ethers.formatEther(balance)} ETH`);
      }
      
      // Initialize contract
      this.contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        CONTRACT_CONFIG.ABI,
        this.workerWallet
      );
      
      // Test contract connection
      const potState = await this.contract.getPotState();
      logger.info(`🎯 Contract connected - Current pot: ${ethers.formatEther(potState.totalAmount)} ETH`);
      
    } catch (error) {
      logger.error('❌ Failed to initialize blockchain connection', error);
      throw error;
    }
  }

  async initializeServices() {
    // Initialize notification service
    this.notificationService = new NotificationService(logger);
    await this.notificationService.initialize();
    
    // Initialize balance monitor
    this.balanceMonitor = new BalanceMonitor(
      this.provider,
      this.workerWallet.address,
      this.notificationService,
      logger
    );
    
    // Initialize contract monitor
    this.contractMonitor = new ContractMonitor(
      this.contract,
      this.notificationService,
      logger
    );
    
    // Initialize health check server for Railway
    this.healthCheckServer = new HealthCheckServer(
      logger,
      () => this.stats
    );
    
    logger.info('✅ All services initialized');
  }

  setupErrorHandlers() {
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.handleCriticalError(error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.handleCriticalError(reason);
    });

    process.on('SIGINT', () => {
      logger.info('Received SIGINT, gracefully shutting down...');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, gracefully shutting down...');
      this.shutdown();
    });
  }

  async start() {
    if (this.isRunning) {
      logger.warn('⚠️ Automation service is already running');
      return;
    }
    
    this.isRunning = true;
    logger.info('🟢 Starting SmolPot automation monitoring...');
    
    // Start monitoring services
    this.balanceMonitor.start();
    this.contractMonitor.start();
    
    // Start health check server (for Railway monitoring)
    if (process.env.PORT) {
      this.healthCheckServer.start();
    }
    
    // Start main monitoring loop
    this.startMonitoringLoop();
    
    // Set up scheduled tasks
    this.setupScheduledTasks();
    
    logger.info('✅ SmolPot automation service is now running');
  }

  startMonitoringLoop() {
    const monitor = async () => {
      if (!this.isRunning) return;
      
      try {
        await this.checkAndDrawWinner();
        this.stats.monitored++;
      } catch (error) {
        this.stats.errors++;
        logger.error('❌ Error in monitoring loop', error);
        
        if (this.stats.errors > MONITORING_CONFIG.MAX_CONSECUTIVE_ERRORS) {
          logger.error('🚨 Too many consecutive errors, sending alert');
          await this.notificationService.sendError({
            type: 'consecutive_errors',
            count: this.stats.errors,
            lastError: error.message
          });
        }
      }
      
      // Schedule next check
      setTimeout(monitor, MONITORING_CONFIG.CHECK_INTERVAL);
    };
    
    // Start monitoring
    monitor();
  }

  async checkAndDrawWinner() {
    try {
      // Get current pot state
      const potState = await this.contract.getPotState();
      
      const shouldDraw = (
        potState.isActive &&
        potState.timeRemaining === 0n &&
        potState.uniqueParticipants >= BigInt(MONITORING_CONFIG.MIN_PARTICIPANTS)
      );
      
      if (shouldDraw) {
        logger.info(`🎲 Conditions met for drawing winner - Pot: ${ethers.formatEther(potState.totalAmount)} ETH, Participants: ${potState.uniqueParticipants}`);
        
        await this.drawWinner(potState);
        this.stats.winnersDrawn++;
        this.stats.lastActivity = new Date();
      }
      
    } catch (error) {
      // If error is "no active pot" or similar, it's not critical
      if (error.message.includes('No active pot') || error.message.includes('revert')) {
        // This is normal - just log at debug level
        return;
      }
      
      throw error; // Re-throw unexpected errors
    }
  }

  async drawWinner(potState) {
    try {
      logger.info('🎯 Attempting to draw winner...');
      
      // Estimate gas
      const gasEstimate = await this.contract.drawWinner.estimateGas();
      const gasLimit = gasEstimate * 120n / 100n; // Add 20% buffer
      
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice * 110n / 100n; // Add 10% buffer
      
      logger.info(`💨 Gas estimate: ${gasEstimate}, Price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
      
      // Execute transaction
      const tx = await this.contract.drawWinner({
        gasLimit,
        gasPrice
      });
      
      logger.info(`📤 Transaction submitted: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait(MONITORING_CONFIG.CONFIRMATION_BLOCKS);
      
      logger.info(`✅ Winner drawn successfully! Gas used: ${receipt.gasUsed}`);
      
      // Parse winner from events
      const winnerEvent = receipt.logs.find(log => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed.name === 'WinnerDrawn';
        } catch {
          return false;
        }
      });
      
      if (winnerEvent) {
        const parsed = this.contract.interface.parseLog(winnerEvent);
        await this.notificationService.sendWinnerDrawn({
          winner: parsed.args.winner,
          amount: ethers.formatEther(parsed.args.amount),
          feeAmount: ethers.formatEther(parsed.args.feeAmount),
          potId: parsed.args.potId.toString(),
          txHash: receipt.hash,
          gasUsed: receipt.gasUsed.toString()
        });
      }
      
    } catch (error) {
      logger.error('❌ Failed to draw winner', error);
      
      await this.notificationService.sendError({
        type: 'winner_draw_failed',
        error: error.message,
        potValue: ethers.formatEther(potState.totalAmount),
        participants: potState.uniqueParticipants.toString()
      });
      
      throw error;
    }
  }

  setupScheduledTasks() {
    // Health check every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed', error);
      }
    });
    
    // Stats report every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      try {
        await this.sendStatsReport();
      } catch (error) {
        logger.error('Stats report failed', error);
      }
    });
    
    logger.info('✅ Scheduled tasks configured');
  }

  async performHealthCheck() {
    const balance = await this.getWorkerBalance();
    const uptime = Math.floor((Date.now() - this.stats.uptime) / 1000);
    
    await this.notificationService.sendHealthCheck({
      status: 'healthy',
      balance: ethers.formatEther(balance),
      uptime: uptime,
      stats: this.stats
    });
  }

  async sendStatsReport() {
    const balance = await this.getWorkerBalance();
    const uptime = Math.floor((Date.now() - this.stats.uptime) / 1000);
    
    await this.notificationService.sendStatsReport({
      ...this.stats,
      balance: ethers.formatEther(balance),
      uptime: uptime
    });
  }

  async getWorkerBalance() {
    return await this.provider.getBalance(this.workerWallet.address);
  }

  async handleCriticalError(error) {
    logger.error('🚨 Critical error occurred', error);
    
    try {
      await this.notificationService.sendCriticalError({
        error: error.message,
        stack: error.stack,
        stats: this.stats
      });
    } catch (notificationError) {
      logger.error('Failed to send critical error notification', notificationError);
    }
    
    // Graceful shutdown
    setTimeout(() => process.exit(1), 5000);
  }

  async shutdown() {
    logger.info('🔄 Shutting down automation service...');
    
    this.isRunning = false;
    
    // Stop services
    if (this.balanceMonitor) this.balanceMonitor.stop();
    if (this.contractMonitor) this.contractMonitor.stop();
    if (this.healthCheckServer) this.healthCheckServer.stop();
    
    // Send shutdown notification
    try {
      await this.notificationService.sendShutdown({
        uptime: Math.floor((Date.now() - this.stats.uptime) / 1000),
        stats: this.stats
      });
    } catch (error) {
      logger.error('Failed to send shutdown notification', error);
    }
    
    logger.info('✅ SmolPot automation service stopped');
    process.exit(0);
  }
}

// Main execution
async function main() {
  const automation = new SmolPotAutomation();
  
  try {
    await automation.initialize();
    await automation.start();
  } catch (error) {
    logger.error('Failed to start automation service', error);
    process.exit(1);
  }
}

// Handle direct execution
if (require.main === module) {
  main();
}

module.exports = SmolPotAutomation;