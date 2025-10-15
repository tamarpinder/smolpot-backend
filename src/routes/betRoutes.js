/**
 * Bet Routes
 * API endpoints for handling bet placement and pot interactions
 *
 * Endpoints:
 * - POST /api/bets/enter - Enter the pot on behalf of a player (operator model)
 * - GET /api/bets/history/:address - Get bet history for a player
 * - GET /api/pot/state - Get current pot state
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const ContractService = require('../services/contractService');
const SupabaseService = require('../services/supabaseService');

const router = express.Router();

/**
 * POST /api/bets/enter
 * Enter the pot on behalf of a player
 *
 * Request body:
 * - userAddress: string (player's wallet address)
 * - betAmount: string (amount in SMOL tokens)
 *
 * Response:
 * - success: boolean
 * - txHash: string (transaction hash)
 * - message: string
 */
router.post(
  '/enter',
  [
    body('userAddress')
      .trim()
      .notEmpty()
      .withMessage('userAddress is required')
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address'),
    body('betAmount')
      .trim()
      .notEmpty()
      .withMessage('betAmount is required')
      .isFloat({ min: 0.000001 })
      .withMessage('betAmount must be a positive number')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { userAddress, betAmount } = req.body;

      // Get services
      const contractService = ContractService.getInstance();
      const supabaseService = SupabaseService.getInstance();

      // Get or create user
      const user = await supabaseService.getOrCreateUser(userAddress);

      // Get current game round
      let currentRound = await supabaseService.getCurrentGameRound();

      // If no active round exists, create one
      if (!currentRound) {
        currentRound = await supabaseService.createGameRound();
      }

      // Check if game is locked
      if (currentRound.status === 'LOCKED') {
        return res.status(400).json({
          success: false,
          message: 'Game is locked. Please wait for the next round.'
        });
      }

      // Enter the pot on-chain (this is where the treasury wallet acts as operator)
      const txResult = await contractService.enterPotFor(userAddress, betAmount);

      // Record the bet in the database
      await supabaseService.recordBet({
        roundId: currentRound.id,
        userId: user.id,
        amount: betAmount,
        txHash: txResult.txHash
      });

      // Update the total pot amount for the round
      const newTotalPot = (
        parseFloat(currentRound.total_pot || '0') + parseFloat(betAmount)
      ).toString();

      await supabaseService.updateGameRound(currentRound.id, {
        total_pot: newTotalPot
      });

      res.json({
        success: true,
        txHash: txResult.txHash,
        blockNumber: txResult.blockNumber,
        roundId: currentRound.id,
        message: 'Bet placed successfully'
      });
    } catch (error) {
      console.error('Error placing bet:', error);

      // Provide user-friendly error messages
      let errorMessage = 'Failed to place bet';
      let statusCode = 500;

      if (error.message.includes('insufficient')) {
        errorMessage = error.message;
        statusCode = 400;
      } else if (error.message.includes('not approved')) {
        errorMessage = 'Please approve SMOL token spending first';
        statusCode = 400;
      } else if (error.message.includes('minimum') || error.message.includes('maximum')) {
        errorMessage = error.message;
        statusCode = 400;
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * GET /api/bets/history/:address
 * Get bet history for a specific player
 */
router.get(
  '/history/:address',
  [
    param('address')
      .trim()
      .notEmpty()
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { address } = req.params;
      const supabaseService = SupabaseService.getInstance();

      // Get player stats
      const stats = await supabaseService.getPlayerStats(address);

      res.json({
        success: true,
        stats
      });
    } catch (error) {
      console.error('Error fetching bet history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bet history',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * GET /api/pot/state
 * Get the current pot state from the smart contract
 */
router.get('/pot/state', async (req, res) => {
  try {
    const contractService = ContractService.getInstance();
    const potState = await contractService.getPotState();

    res.json({
      success: true,
      potState
    });
  } catch (error) {
    console.error('Error fetching pot state:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pot state',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/pot/history
 * Get historical game rounds
 */
router.get('/pot/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const supabaseService = SupabaseService.getInstance();

    const history = await supabaseService.getGameRoundHistory(limit);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Error fetching pot history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pot history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/bets/round/:roundId
 * Get all bets for a specific round
 */
router.get(
  '/round/:roundId',
  [
    param('roundId')
      .trim()
      .notEmpty()
      .isInt()
      .withMessage('Invalid round ID')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { roundId } = req.params;
      const supabaseService = SupabaseService.getInstance();

      const bets = await supabaseService.getBetsForRound(parseInt(roundId));

      res.json({
        success: true,
        bets
      });
    } catch (error) {
      console.error('Error fetching bets for round:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bets for round',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

module.exports = router;
