const { ethers } = require('ethers');
const { WORKER_CONFIG, MONITORING_CONFIG } = require('../config');

class BalanceMonitor {
  constructor(provider, workerAddress, notificationService, logger) {
    this.provider = provider;
    this.workerAddress = workerAddress;
    this.notificationService = notificationService;
    this.logger = logger;
    this.isRunning = false;
    this.intervalId = null;
    this.lastBalance = null;
  }

  start() {
    if (this.isRunning) {
      this.logger.warn('Balance monitor is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('💰 Starting balance monitor...');

    // Check balance immediately
    this.checkBalance();

    // Set up periodic balance checks (every 5 minutes)
    this.intervalId = setInterval(() => {
      this.checkBalance();
    }, 5 * 60 * 1000);

    this.logger.info('✅ Balance monitor started');
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.logger.info('✅ Balance monitor stopped');
  }

  async checkBalance() {
    try {
      const balance = await this.provider.getBalance(this.workerAddress);
      const balanceEth = parseFloat(ethers.formatEther(balance));
      const threshold = parseFloat(WORKER_CONFIG.LOW_BALANCE_THRESHOLD);

      // Log balance change if significant
      if (this.lastBalance) {
        const lastBalanceEth = parseFloat(ethers.formatEther(this.lastBalance));
        const difference = balanceEth - lastBalanceEth;
        
        if (Math.abs(difference) > 0.001) { // Log changes > 0.001 ETH
          this.logger.info(`💰 Balance changed: ${lastBalanceEth.toFixed(6)} → ${balanceEth.toFixed(6)} ETH (${difference > 0 ? '+' : ''}${difference.toFixed(6)})`);
        }
      }

      this.lastBalance = balance;

      // Check if balance is below threshold
      if (balanceEth < threshold) {
        this.logger.warn(`⚠️ Worker balance is low: ${balanceEth.toFixed(6)} ETH (threshold: ${threshold} ETH)`);
        
        await this.notificationService.sendLowBalance({
          workerAddress: this.workerAddress,
          balance: balanceEth.toFixed(6),
          threshold: threshold.toString()
        });
      }

      // Check if balance is critically low (can't pay for transactions)
      const minBalance = parseFloat(WORKER_CONFIG.MIN_BALANCE_ETH);
      if (balanceEth < minBalance) {
        this.logger.error(`🚨 Worker balance critically low: ${balanceEth.toFixed(6)} ETH`);
        
        await this.notificationService.sendCriticalError({
          error: `Worker balance critically low: ${balanceEth.toFixed(6)} ETH`,
          stats: { criticalBalance: true }
        });
      }

    } catch (error) {
      this.logger.error('❌ Failed to check worker balance:', error);
    }
  }

  async getBalance() {
    try {
      const balance = await this.provider.getBalance(this.workerAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      this.logger.error('❌ Failed to get worker balance:', error);
      return '0';
    }
  }

  // Estimate gas cost for a transaction
  async estimateTransactionCost(gasLimit, gasPrice = null) {
    try {
      if (!gasPrice) {
        const feeData = await this.provider.getFeeData();
        gasPrice = feeData.gasPrice;
      }

      const cost = gasLimit * gasPrice;
      return ethers.formatEther(cost);
    } catch (error) {
      this.logger.error('❌ Failed to estimate transaction cost:', error);
      return '0';
    }
  }

  // Check if wallet has enough balance for a specific transaction
  async canAffordTransaction(gasLimit, gasPrice = null) {
    try {
      const balance = await this.provider.getBalance(this.workerAddress);
      
      if (!gasPrice) {
        const feeData = await this.provider.getFeeData();
        gasPrice = feeData.gasPrice;
      }

      const cost = gasLimit * gasPrice;
      return balance > cost;
    } catch (error) {
      this.logger.error('❌ Failed to check transaction affordability:', error);
      return false;
    }
  }
}

module.exports = { BalanceMonitor };