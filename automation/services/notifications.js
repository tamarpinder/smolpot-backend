const axios = require('axios');
const { NOTIFICATION_CONFIG } = require('../config');

class NotificationService {
  constructor(logger) {
    this.logger = logger;
    this.discordWebhook = process.env.DISCORD_WEBHOOK_URL;
    this.cooldowns = new Map(); // Rate limiting for notifications
  }

  async initialize() {
    if (NOTIFICATION_CONFIG.DISCORD_ENABLED) {
      this.logger.info('🔔 Discord notifications enabled');
    } else {
      this.logger.info('📢 Console-only notifications enabled');
    }
  }

  async sendStartup(data) {
    const message = {
      title: '🚀 SmolPot Automation Started',
      description: 'Automation service is now monitoring the lottery contract',
      fields: [
        {
          name: '👤 Worker Address',
          value: `\`${data.workerAddress}\``,
          inline: true
        },
        {
          name: '💰 Worker Balance',
          value: `${data.balance} ETH`,
          inline: true
        },
        {
          name: '🌐 Network',
          value: data.networkName,
          inline: true
        }
      ],
      color: 0x00ff00, // Green
      timestamp: new Date().toISOString()
    };

    await this.send(NOTIFICATION_CONFIG.TYPES.STARTUP, message);
  }

  async sendShutdown(data) {
    const uptimeHours = Math.floor(data.uptime / 3600);
    const uptimeMinutes = Math.floor((data.uptime % 3600) / 60);

    const message = {
      title: '🔴 SmolPot Automation Stopped',
      description: 'Automation service has been shut down',
      fields: [
        {
          name: '⏰ Uptime',
          value: `${uptimeHours}h ${uptimeMinutes}m`,
          inline: true
        },
        {
          name: '📊 Winners Drawn',
          value: data.stats.winnersDrawn.toString(),
          inline: true
        },
        {
          name: '❌ Errors',
          value: data.stats.errors.toString(),
          inline: true
        }
      ],
      color: 0xff0000, // Red
      timestamp: new Date().toISOString()
    };

    await this.send(NOTIFICATION_CONFIG.TYPES.SHUTDOWN, message);
  }

  async sendWinnerDrawn(data) {
    const message = {
      title: '🎉 Winner Drawn Successfully!',
      description: `Pot winner has been selected and prizes distributed`,
      fields: [
        {
          name: '🏆 Winner',
          value: `\`${this.truncateAddress(data.winner)}\``,
          inline: true
        },
        {
          name: '💰 Prize',
          value: `${data.amount} ETH`,
          inline: true
        },
        {
          name: '🏛️ Platform Fee',
          value: `${data.feeAmount} ETH`,
          inline: true
        },
        {
          name: '🎯 Pot ID',
          value: data.potId,
          inline: true
        },
        {
          name: '💨 Gas Used',
          value: data.gasUsed,
          inline: true
        },
        {
          name: '🔗 Transaction',
          value: `[View on Explorer](https://sepolia.abscan.org/tx/${data.txHash})`,
          inline: false
        }
      ],
      color: 0xffd700, // Gold
      timestamp: new Date().toISOString()
    };

    await this.send(NOTIFICATION_CONFIG.TYPES.WINNER_DRAWN, message);
  }

  async sendError(data) {
    // Check cooldown to avoid spam
    const errorKey = `error_${data.type}`;
    if (this.isOnCooldown(errorKey, NOTIFICATION_CONFIG.ERROR_COOLDOWN)) {
      return;
    }

    const message = {
      title: '⚠️ Automation Error',
      description: 'An error occurred in the automation service',
      fields: [
        {
          name: '🏷️ Error Type',
          value: data.type,
          inline: true
        },
        {
          name: '📝 Error Message',
          value: `\`${data.error.substring(0, 1000)}\``,
          inline: false
        }
      ],
      color: 0xff9900, // Orange
      timestamp: new Date().toISOString()
    };

    if (data.potValue) {
      message.fields.push({
        name: '💰 Pot Value',
        value: `${data.potValue} ETH`,
        inline: true
      });
    }

    if (data.participants) {
      message.fields.push({
        name: '👥 Participants',
        value: data.participants,
        inline: true
      });
    }

    await this.send(NOTIFICATION_CONFIG.TYPES.ERROR, message);
  }

  async sendCriticalError(data) {
    const message = {
      title: '🚨 CRITICAL ERROR - Service Stopping',
      description: 'A critical error has occurred and the service is shutting down',
      fields: [
        {
          name: '💥 Error',
          value: `\`${data.error}\``,
          inline: false
        },
        {
          name: '📊 Winners Drawn',
          value: data.stats.winnersDrawn.toString(),
          inline: true
        },
        {
          name: '❌ Total Errors',
          value: data.stats.errors.toString(),
          inline: true
        }
      ],
      color: 0x990000, // Dark Red
      timestamp: new Date().toISOString()
    };

    if (data.stack) {
      message.fields.push({
        name: '🔍 Stack Trace (truncated)',
        value: `\`\`\`${data.stack.substring(0, 800)}\`\`\``,
        inline: false
      });
    }

    await this.send(NOTIFICATION_CONFIG.TYPES.CRITICAL_ERROR, message, true); // Force send
  }

  async sendLowBalance(data) {
    const balanceKey = 'low_balance';
    if (this.isOnCooldown(balanceKey, NOTIFICATION_CONFIG.BALANCE_ALERT_COOLDOWN)) {
      return;
    }

    const message = {
      title: '⚠️ Low Worker Balance',
      description: 'Worker wallet balance is running low and needs funding',
      fields: [
        {
          name: '👤 Worker Address',
          value: `\`${data.workerAddress}\``,
          inline: false
        },
        {
          name: '💰 Current Balance',
          value: `${data.balance} ETH`,
          inline: true
        },
        {
          name: '⚡ Threshold',
          value: `${data.threshold} ETH`,
          inline: true
        },
        {
          name: '🚨 Action Required',
          value: 'Please fund the worker wallet to continue automated operations',
          inline: false
        }
      ],
      color: 0xff6600, // Orange-Red
      timestamp: new Date().toISOString()
    };

    await this.send(NOTIFICATION_CONFIG.TYPES.LOW_BALANCE, message);
  }

  async sendHealthCheck(data) {
    const uptimeHours = Math.floor(data.uptime / 3600);
    const uptimeMinutes = Math.floor((data.uptime % 3600) / 60);

    const message = {
      title: '💚 Health Check - All Systems Operational',
      description: 'Automated health check report',
      fields: [
        {
          name: '⏰ Uptime',
          value: `${uptimeHours}h ${uptimeMinutes}m`,
          inline: true
        },
        {
          name: '💰 Worker Balance',
          value: `${data.balance} ETH`,
          inline: true
        },
        {
          name: '🔍 Checks Performed',
          value: data.stats.monitored.toString(),
          inline: true
        },
        {
          name: '🎉 Winners Drawn',
          value: data.stats.winnersDrawn.toString(),
          inline: true
        },
        {
          name: '❌ Errors',
          value: data.stats.errors.toString(),
          inline: true
        },
        {
          name: '🏃 Status',
          value: data.status.toUpperCase(),
          inline: true
        }
      ],
      color: 0x00ff88, // Light Green
      timestamp: new Date().toISOString()
    };

    await this.send(NOTIFICATION_CONFIG.TYPES.HEALTH_CHECK, message);
  }

  async sendStatsReport(data) {
    const uptimeHours = Math.floor(data.uptime / 3600);
    const uptimeMinutes = Math.floor((data.uptime % 3600) / 60);
    
    const lastActivity = data.lastActivity ? 
      new Date(data.lastActivity).toLocaleString() : 'Never';

    const message = {
      title: '📊 SmolPot Automation Stats Report',
      description: 'Periodic statistics and performance report',
      fields: [
        {
          name: '⏰ Service Uptime',
          value: `${uptimeHours}h ${uptimeMinutes}m`,
          inline: true
        },
        {
          name: '💰 Worker Balance',
          value: `${data.balance} ETH`,
          inline: true
        },
        {
          name: '🔍 Total Checks',
          value: data.monitored.toString(),
          inline: true
        },
        {
          name: '🎉 Winners Drawn',
          value: data.winnersDrawn.toString(),
          inline: true
        },
        {
          name: '❌ Total Errors',
          value: data.errors.toString(),
          inline: true
        },
        {
          name: '🕐 Last Activity',
          value: lastActivity,
          inline: true
        }
      ],
      color: 0x0099ff, // Blue
      timestamp: new Date().toISOString()
    };

    await this.send(NOTIFICATION_CONFIG.TYPES.STATS_REPORT, message);
  }

  async send(type, message, force = false) {
    try {
      // Console logging
      if (NOTIFICATION_CONFIG.CONSOLE_ENABLED) {
        this.logger.info(`📢 ${message.title}: ${message.description}`);
      }

      // Discord webhook
      if (NOTIFICATION_CONFIG.DISCORD_ENABLED && this.discordWebhook) {
        const payload = {
          embeds: [message]
        };

        await axios.post(this.discordWebhook, payload, {
          timeout: 10000
        });

        this.logger.info(`🔔 Discord notification sent: ${type}`);
      }

      // Update cooldown if not forced
      if (!force) {
        this.setCooldown(type);
      }

    } catch (error) {
      this.logger.error(`❌ Failed to send ${type} notification:`, error.message);
    }
  }

  isOnCooldown(key, cooldownMs) {
    const lastSent = this.cooldowns.get(key);
    if (!lastSent) return false;
    
    return (Date.now() - lastSent) < cooldownMs;
  }

  setCooldown(key) {
    this.cooldowns.set(key, Date.now());
  }

  truncateAddress(address, startChars = 6, endChars = 4) {
    if (!address || address.length <= startChars + endChars) {
      return address;
    }
    
    return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
  }
}

module.exports = { NotificationService };