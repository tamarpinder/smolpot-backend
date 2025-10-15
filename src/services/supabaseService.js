/**
 * Supabase Service
 * Handles all database operations for SmolPot backend
 *
 * Database tables:
 * - users: Player profiles and wallet addresses
 * - game_rounds: Game round history and state
 * - bets: Individual bet records with transaction hashes
 *
 * This service uses the Supabase service role key for backend operations
 * to bypass Row Level Security policies.
 */

const { createClient } = require('@supabase/supabase-js');
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

class SupabaseService {
  constructor() {
    if (SupabaseService.instance) {
      return SupabaseService.instance;
    }

    this.client = null;
    this.initialized = false;

    SupabaseService.instance = this;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  /**
   * Initialize the Supabase service
   */
  async initialize() {
    if (this.initialized) {
      logger.info('SupabaseService already initialized');
      return;
    }

    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

      if (!supabaseUrl) {
        throw new Error('SUPABASE_URL environment variable is required');
      }
      if (!supabaseKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required');
      }

      // Create Supabase client
      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });

      logger.info('Supabase Service initialized successfully');
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Supabase Service', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get or create a user by wallet address
   * @param {string} walletAddress
   * @returns {Promise<object>} User record
   */
  async getOrCreateUser(walletAddress) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      // Try to find existing user
      const { data: existingUser, error: findError } = await this.client
        .from('users')
        .select('*')
        .eq('wallet_address', walletAddress.toLowerCase())
        .single();

      if (existingUser) {
        return existingUser;
      }

      // Create new user if not found
      const { data: newUser, error: createError } = await this.client
        .from('users')
        .insert([
          {
            wallet_address: walletAddress.toLowerCase(),
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      logger.info('New user created', { wallet_address: walletAddress });
      return newUser;
    } catch (error) {
      logger.error('Failed to get or create user', {
        error: error.message,
        wallet_address: walletAddress
      });
      throw error;
    }
  }

  /**
   * Get the current active game round
   * @returns {Promise<object|null>} Current game round or null
   */
  async getCurrentGameRound() {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('game_rounds')
        .select('*')
        .in('status', ['BETTING', 'LOCKED'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get current game round', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a new game round
   * @param {object} roundData
   * @returns {Promise<object>} Created game round
   */
  async createGameRound(roundData = {}) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('game_rounds')
        .insert([
          {
            status: 'BETTING',
            total_pot: '0',
            start_time: new Date().toISOString(),
            ...roundData
          }
        ])
        .select()
        .single();

      if (error) {
        throw error;
      }

      logger.info('New game round created', { round_id: data.id });
      return data;
    } catch (error) {
      logger.error('Failed to create game round', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update a game round
   * @param {number} roundId
   * @param {object} updates
   * @returns {Promise<object>} Updated game round
   */
  async updateGameRound(roundId, updates) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('game_rounds')
        .update(updates)
        .eq('id', roundId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      logger.info('Game round updated', { round_id: roundId, updates });
      return data;
    } catch (error) {
      logger.error('Failed to update game round', {
        error: error.message,
        round_id: roundId
      });
      throw error;
    }
  }

  /**
   * Record a bet in the database
   * @param {object} betData
   * @returns {Promise<object>} Created bet record
   */
  async recordBet(betData) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('bets')
        .insert([
          {
            round_id: betData.roundId,
            user_id: betData.userId,
            amount: betData.amount,
            tx_hash: betData.txHash,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (error) {
        throw error;
      }

      logger.info('Bet recorded', {
        bet_id: data.id,
        round_id: betData.roundId,
        amount: betData.amount
      });

      return data;
    } catch (error) {
      logger.error('Failed to record bet', {
        error: error.message,
        bet_data: betData
      });
      throw error;
    }
  }

  /**
   * Get all bets for a game round
   * @param {number} roundId
   * @returns {Promise<array>} Array of bets
   */
  async getBetsForRound(roundId) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('bets')
        .select(`
          *,
          users (
            wallet_address,
            username
          )
        `)
        .eq('round_id', roundId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to get bets for round', {
        error: error.message,
        round_id: roundId
      });
      throw error;
    }
  }

  /**
   * Get game round history
   * @param {number} limit - Number of rounds to fetch
   * @returns {Promise<array>} Array of game rounds
   */
  async getGameRoundHistory(limit = 10) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('game_rounds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to get game round history', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get stats for a player
   * @param {string} walletAddress
   * @returns {Promise<object>} Player stats
   */
  async getPlayerStats(walletAddress) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      // Get user
      const user = await this.getOrCreateUser(walletAddress);

      // Get total bets
      const { data: bets, error: betsError } = await this.client
        .from('bets')
        .select('amount')
        .eq('user_id', user.id);

      if (betsError) {
        throw betsError;
      }

      // Get wins
      const { data: wins, error: winsError } = await this.client
        .from('game_rounds')
        .select('total_pot')
        .eq('winner_address', walletAddress.toLowerCase())
        .eq('status', 'COMPLETE');

      if (winsError) {
        throw winsError;
      }

      const totalBets = bets.length;
      const totalWagered = bets.reduce((sum, bet) => sum + parseFloat(bet.amount), 0);
      const totalWins = wins.length;
      const totalWon = wins.reduce((sum, round) => sum + parseFloat(round.total_pot), 0);

      return {
        totalBets,
        totalWagered: totalWagered.toString(),
        totalWins,
        totalWon: totalWon.toString(),
        netProfit: (totalWon - totalWagered).toString()
      };
    } catch (error) {
      logger.error('Failed to get player stats', {
        error: error.message,
        wallet_address: walletAddress
      });
      throw error;
    }
  }

  /**
   * Create EOS proof record for verification
   * @param {object} proofData
   * @returns {Promise<object>} Created proof record
   */
  async createEosProof(proofData) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('eos_proofs')
        .insert([proofData])
        .select()
        .single();

      if (error) {
        throw error;
      }

      logger.info('EOS proof created', {
        pot_id: proofData.pot_id,
        block_num: proofData.eos_block_number
      });

      return data;
    } catch (error) {
      logger.error('Failed to create EOS proof', {
        error: error.message,
        proof_data: proofData
      });
      throw error;
    }
  }

  /**
   * Get game round by pot ID
   * @param {string} potId
   * @returns {Promise<object|null>} Game round or null
   */
  async getGameRoundByPotId(potId) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('game_rounds')
        .select('*')
        .eq('pot_id', potId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get game round by pot ID', {
        error: error.message,
        pot_id: potId
      });
      throw error;
    }
  }

  /**
   * Update game round by pot ID
   * @param {string} potId
   * @param {object} updates
   * @returns {Promise<object>} Updated game round
   */
  async updateGameRoundByPotId(potId, updates) {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.client
        .from('game_rounds')
        .update(updates)
        .eq('pot_id', potId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      logger.info('Game round updated by pot ID', { pot_id: potId, updates });
      return data;
    } catch (error) {
      logger.error('Failed to update game round by pot ID', {
        error: error.message,
        pot_id: potId
      });
      throw error;
    }
  }

  /**
   * Get the Supabase client (for advanced usage)
   */
  getClient() {
    if (!this.initialized) {
      throw new Error('SupabaseService not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Check if the service is initialized
   */
  isInitialized() {
    return this.initialized;
  }
}

module.exports = SupabaseService;
