const { ethers } = require('ethers');
const { MONITORING_CONFIG } = require('../config');

class ContractMonitor {
  constructor(contract, notificationService, logger) {
    this.contract = contract;
    this.notificationService = notificationService;
    this.logger = logger;
    this.isRunning = false;
    this.eventListeners = [];
    this.lastPotState = null;
    this.consecutiveErrors = 0;
  }

  start() {
    if (this.isRunning) {
      this.logger.warn('Contract monitor is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('📡 Starting contract event monitoring...');

    // Set up event listeners
    this.setupEventListeners();

    this.logger.info('✅ Contract monitor started');
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Remove event listeners
    this.removeEventListeners();

    this.logger.info('✅ Contract monitor stopped');
  }

  setupEventListeners() {
    try {
      // Note: Event listeners disabled due to Abstract testnet filter issues
      // The main polling loop will handle winner detection instead
      this.logger.info('📡 Event listeners disabled (using polling-based monitoring for Abstract testnet compatibility)');

    } catch (error) {
      this.logger.error('❌ Failed to setup event listeners:', error);
    }
  }

  removeEventListeners() {
    try {
      this.eventListeners.forEach(({ event, listener }) => {
        this.contract.off(event, listener);
      });

      this.eventListeners = [];
      this.logger.info('📡 Event listeners removed');

    } catch (error) {
      this.logger.error('❌ Failed to remove event listeners:', error);
    }
  }

  async handlePotEntry(data) {
    try {
      this.logger.info(`💰 New pot entry: ${data.amount} ETH from ${this.truncateAddress(data.user)}`);

      // Reset consecutive errors on successful event
      this.consecutiveErrors = 0;

      // Optional: Send notification for large entries
      const entryAmount = parseFloat(data.amount);
      if (entryAmount >= 0.1) { // Notify for entries >= 0.1 ETH
        await this.notificationService.send('pot_entry', {
          title: '💰 Large Pot Entry',
          description: `Significant entry detected in the current pot`,
          fields: [
            {
              name: '👤 Player',
              value: `\`${this.truncateAddress(data.user)}\``,
              inline: true
            },
            {
              name: '💰 Amount',
              value: `${data.amount} ETH`,
              inline: true
            },
            {
              name: '🔗 Transaction',
              value: `[View](https://sepolia.abscan.org/tx/${data.transactionHash})`,
              inline: true
            }
          ],
          color: 0x00ff99,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      this.logger.error('❌ Error handling pot entry event:', error);
      this.consecutiveErrors++;
    }
  }

  async handleWinnerDrawn(data) {
    try {
      this.logger.info(`🎉 Winner drawn: ${data.amount} ETH to ${this.truncateAddress(data.winner)} (Pot ${data.potId})`);

      // Reset consecutive errors on successful event
      this.consecutiveErrors = 0;

      // This notification is likely handled by the main service, but we can log it here
      this.logger.info(`🏆 Pot ${data.potId} completed - Winner: ${this.truncateAddress(data.winner)}, Prize: ${data.amount} ETH`);

    } catch (error) {
      this.logger.error('❌ Error handling winner drawn event:', error);
      this.consecutiveErrors++;
    }
  }

  // Monitor pot state changes
  async checkPotStateChanges() {
    try {
      const currentState = await this.contract.getPotState();
      
      if (this.lastPotState) {
        // Check for significant changes
        const changes = this.detectStateChanges(this.lastPotState, currentState);
        
        if (changes.length > 0) {
          this.logger.info(`📊 Pot state changes detected: ${changes.join(', ')}`);
        }
      }
      
      this.lastPotState = currentState;
      this.consecutiveErrors = 0;

    } catch (error) {
      this.logger.error('❌ Failed to check pot state:', error);
      this.consecutiveErrors++;
      
      // Alert if too many consecutive errors
      if (this.consecutiveErrors >= MONITORING_CONFIG.MAX_CONSECUTIVE_ERRORS) {
        await this.notificationService.sendError({
          type: 'contract_monitoring_errors',
          error: `${this.consecutiveErrors} consecutive failures monitoring contract`,
          count: this.consecutiveErrors
        });
      }
    }
  }

  detectStateChanges(oldState, newState) {
    const changes = [];

    try {
      // Check total amount change
      if (oldState.totalAmount !== newState.totalAmount) {
        const oldAmount = ethers.formatEther(oldState.totalAmount);
        const newAmount = ethers.formatEther(newState.totalAmount);
        changes.push(`Total: ${oldAmount} → ${newAmount} ETH`);
      }

      // Check participant count change
      if (oldState.uniqueParticipants !== newState.uniqueParticipants) {
        changes.push(`Participants: ${oldState.uniqueParticipants} → ${newState.uniqueParticipants}`);
      }

      // Check entry count change
      if (oldState.entryCount !== newState.entryCount) {
        changes.push(`Entries: ${oldState.entryCount} → ${newState.entryCount}`);
      }

      // Check active status change
      if (oldState.isActive !== newState.isActive) {
        changes.push(`Status: ${oldState.isActive ? 'Active' : 'Inactive'} → ${newState.isActive ? 'Active' : 'Inactive'}`);
      }

      // Check pot ID change (indicates new pot)
      if (oldState.potId !== newState.potId) {
        changes.push(`New Pot: #${oldState.potId} → #${newState.potId}`);
      }

      // Check timer changes (significant changes only)
      const timerDiff = Math.abs(Number(oldState.timeRemaining) - Number(newState.timeRemaining));
      if (timerDiff > 5) { // Only log if difference is > 5 seconds (not just normal countdown)
        changes.push(`Timer: ${oldState.timeRemaining}s → ${newState.timeRemaining}s`);
      }

    } catch (error) {
      this.logger.error('❌ Error detecting state changes:', error);
    }

    return changes;
  }

  // Get current pot status summary
  async getPotSummary() {
    try {
      const state = await this.contract.getPotState();
      
      return {
        potId: state.potId.toString(),
        totalAmount: ethers.formatEther(state.totalAmount),
        entryCount: state.entryCount.toString(),
        uniqueParticipants: state.uniqueParticipants.toString(),
        timeRemaining: state.timeRemaining.toString(),
        isActive: state.isActive,
        readyForDraw: (
          state.isActive &&
          state.timeRemaining === 0n &&
          state.uniqueParticipants >= BigInt(MONITORING_CONFIG.MIN_PARTICIPANTS)
        )
      };
    } catch (error) {
      this.logger.error('❌ Failed to get pot summary:', error);
      return null;
    }
  }

  truncateAddress(address, startChars = 6, endChars = 4) {
    if (!address || address.length <= startChars + endChars) {
      return address;
    }
    
    return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
  }

  getConsecutiveErrors() {
    return this.consecutiveErrors;
  }

  resetErrorCount() {
    this.consecutiveErrors = 0;
  }
}

module.exports = { ContractMonitor };