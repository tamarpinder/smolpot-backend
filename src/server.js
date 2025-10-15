/**
 * SmolPot Backend Server
 * Hybrid centralized-decentralized architecture
 *
 * This server acts as the operator for SmolPot transactions:
 * 1. Co-signs all bet transactions using the Treasury Wallet
 * 2. Automates game management (locking, drawing, finishing)
 * 3. Integrates EOS blockchain for provably fair randomness
 * 4. Stores game history and player data in Supabase
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// Services
const WalletService = require('./services/walletService');
const ContractService = require('./services/contractService');
const SupabaseService = require('./services/supabaseService');
const EosService = require('./services/eosService');

// Routes
const betRoutes = require('./routes/betRoutes');

// Middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: process.env.LOG_FILE_PATH || './logs/backend.log',
      format: winston.format.json()
    })
  ]
});

// Create Express app
const app = express();
const PORT = process.env.PORT || 8080;

// =====================
// Middleware Setup
// =====================

// Security headers
app.use(helmet());

// CORS configuration
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // 100 requests per minute
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// Request logging
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// =====================
// Routes
// =====================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      wallet: WalletService.getInstance().isInitialized(),
      contract: ContractService.getInstance().isInitialized(),
      supabase: SupabaseService.getInstance().isInitialized(),
      eos: EosService.getInstance().isInitialized()
    }
  });
});

// API info endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'SmolPot Backend API',
    version: '2.0.0',
    description: 'Hybrid centralized-decentralized backend for SmolPot lottery game',
    endpoints: {
      health: 'GET /health',
      bets: {
        enter: 'POST /api/bets/enter',
        history: 'GET /api/bets/history/:address',
        round: 'GET /api/bets/round/:roundId'
      },
      pot: {
        state: 'GET /api/pot/state',
        history: 'GET /api/pot/history'
      }
    }
  });
});

// Bet routes
app.use('/api/bets', betRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// =====================
// Service Initialization
// =====================

async function initializeServices() {
  try {
    logger.info('Initializing SmolPot Backend Services...');

    // Initialize services in order
    logger.info('1/4 Initializing Treasury Wallet Service...');
    const walletService = WalletService.getInstance();
    await walletService.initialize();

    logger.info('2/4 Initializing Contract Service...');
    const contractService = ContractService.getInstance();
    await contractService.initialize();

    logger.info('3/4 Initializing Supabase Service...');
    const supabaseService = SupabaseService.getInstance();
    await supabaseService.initialize();

    logger.info('4/4 Initializing EOS Service...');
    const eosService = EosService.getInstance();
    // EOS service initializes in constructor

    // Verify Treasury Wallet is approved as operator (if function exists)
    const treasuryAddress = walletService.getTreasuryAddress();
    try {
      const isApproved = await contractService.isApprovedOperator(treasuryAddress);

      if (!isApproved) {
        logger.warn(
          '⚠️  WARNING: Treasury Wallet is NOT approved as an operator on SmolPotCore contract!'
        );
        logger.warn(
          `Please call setOperatorApproval("${treasuryAddress}", true) from the contract owner.`
        );
      } else {
        logger.info('✓ Treasury Wallet is approved as operator');
      }
    } catch (error) {
      logger.warn(
        '⚠️  Could not check operator approval (function may not exist in current contract)'
      );
      logger.warn(
        'Note: The smart contract needs to be refactored for Phase 2 operator model'
      );
    }

    // Get initial pot state
    const potState = await contractService.getPotState();
    logger.info('Current pot state', {
      potId: potState.potId,
      totalAmount: potState.totalAmount,
      entryCount: potState.entryCount,
      isActive: potState.isActive
    });

    logger.info('✓ All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// =====================
// Server Startup
// =====================

async function startServer() {
  try {
    // Initialize all services first
    await initializeServices();

    // Start Express server
    app.listen(PORT, () => {
      logger.info('=================================');
      logger.info('SmolPot Backend Server Started');
      logger.info('=================================');
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Port: ${PORT}`);
      logger.info(`Treasury Wallet: ${WalletService.getInstance().getTreasuryAddress()}`);
      logger.info('=================================');
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason,
    promise
  });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();

module.exports = app;
