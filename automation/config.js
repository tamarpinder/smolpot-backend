module.exports = {
  CONTRACT_CONFIG: {
    NETWORK_NAME: 'Abstract Testnet',
    CHAIN_ID: 11124,
    EXPLORER_URL: 'https://sepolia.abscan.org',
    
    // SmolPotCore ABI - Key functions only
    ABI: [
      // View functions
      {
        "inputs": [],
        "name": "getPotState",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "totalAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "entryCount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "uniqueParticipants",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "timeRemaining",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "potId",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      
      // Transaction functions
      {
        "inputs": [],
        "name": "drawWinner",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "handleIdleRefund",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      
      // Events
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "winner",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "feeAmount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "potId",
            "type": "uint256"
          }
        ],
        "name": "WinnerDrawn",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "user",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "timestamp",
            "type": "uint256"
          }
        ],
        "name": "PotEntry",
        "type": "event"
      }
    ]
  },

  WORKER_CONFIG: {
    MIN_BALANCE_ETH: '0.01',  // Minimum ETH balance for worker wallet
    LOW_BALANCE_THRESHOLD: '0.005',  // Alert when balance drops below this
    GAS_BUFFER_PERCENT: 20,  // Add 20% buffer to gas estimates
    GAS_PRICE_BUFFER_PERCENT: 10,  // Add 10% buffer to gas price
  },

  MONITORING_CONFIG: {
    CHECK_INTERVAL: 3000,   // Check every 3 seconds for near-instant response
    MIN_PARTICIPANTS: 2,    // Minimum participants to draw winner
    CONFIRMATION_BLOCKS: 2, // Wait for 2 confirmations
    MAX_CONSECUTIVE_ERRORS: 5,  // Alert after 5 consecutive errors
    IDLE_TIMEOUT: 300000,   // 5 minutes idle timeout (300 seconds * 1000ms)
    
    // Retry configuration
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000,  // 5 seconds between retries
    
    // Health check intervals
    HEALTH_CHECK_INTERVAL: 3600000,  // Every hour (60 * 60 * 1000ms)
    STATS_REPORT_INTERVAL: 21600000, // Every 6 hours (6 * 60 * 60 * 1000ms)
  },

  NOTIFICATION_CONFIG: {
    DISCORD_ENABLED: process.env.DISCORD_WEBHOOK_URL ? true : false,
    CONSOLE_ENABLED: true,
    
    // Notification types
    TYPES: {
      STARTUP: 'startup',
      SHUTDOWN: 'shutdown',
      WINNER_DRAWN: 'winner_drawn',
      ERROR: 'error',
      CRITICAL_ERROR: 'critical_error',
      LOW_BALANCE: 'low_balance',
      HEALTH_CHECK: 'health_check',
      STATS_REPORT: 'stats_report'
    },
    
    // Rate limiting
    ERROR_COOLDOWN: 300000,  // 5 minutes cooldown between same error notifications
    BALANCE_ALERT_COOLDOWN: 1800000,  // 30 minutes between balance alerts
  }
};