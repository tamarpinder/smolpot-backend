/**
 * EOS Oracle Service
 * Fetches block hashes from the EOS blockchain for provably fair randomness
 *
 * This service:
 * 1. Fetches the latest irreversible block number from EOS
 * 2. Calculates a future block number (e.g., +5 blocks)
 * 3. Polls until the future block is produced
 * 4. Returns the block hash for use as randomness seed
 *
 * The EOS block hash is impossible to predict before the block is produced,
 * making it a secure source of randomness.
 */

const axios = require('axios');
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

class EosService {
  constructor() {
    if (EosService.instance) {
      return EosService.instance;
    }

    // Parse EOS RPC endpoints from environment variable
    const endpoints = (process.env.EOS_RPC_ENDPOINTS || 'https://eos.antelope.tools').split(',');
    this.rpcEndpoints = endpoints.map(url => url.trim());
    this.currentEndpointIndex = 0;
    this.futureBlockOffset = parseInt(process.env.EOS_FUTURE_BLOCKS || '5');
    this.initialized = true;

    logger.info('EOS Service initialized', {
      endpoints: this.rpcEndpoints.length,
      futureBlockOffset: this.futureBlockOffset
    });

    EosService.instance = this;
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!EosService.instance) {
      EosService.instance = new EosService();
    }
    return EosService.instance;
  }

  /**
   * Get the current RPC endpoint
   */
  getCurrentEndpoint() {
    return this.rpcEndpoints[this.currentEndpointIndex];
  }

  /**
   * Switch to the next RPC endpoint (failover)
   */
  switchToNextEndpoint() {
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.rpcEndpoints.length;
    logger.warn('Switching to next EOS RPC endpoint', {
      endpoint: this.getCurrentEndpoint()
    });
  }

  /**
   * Make an RPC call to EOS with automatic failover
   * @param {string} path - API path (e.g., '/v1/chain/get_info')
   * @param {object} data - Request body
   * @returns {Promise<object>} Response data
   */
  async makeRpcCall(path, data = {}) {
    let lastError;
    const maxRetries = this.rpcEndpoints.length;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const endpoint = this.getCurrentEndpoint();
        const url = `${endpoint}${path}`;

        logger.debug('Making EOS RPC call', { url, attempt: attempt + 1 });

        const response = await axios.post(url, data, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        return response.data;
      } catch (error) {
        lastError = error;
        logger.error('EOS RPC call failed', {
          endpoint: this.getCurrentEndpoint(),
          path,
          error: error.message,
          attempt: attempt + 1
        });

        // Try next endpoint if available
        if (attempt < maxRetries - 1) {
          this.switchToNextEndpoint();
        }
      }
    }

    throw new Error(
      `Failed to connect to any EOS RPC endpoint after ${maxRetries} attempts. ` +
      `Last error: ${lastError.message}`
    );
  }

  /**
   * Get the latest chain info from EOS
   * @returns {Promise<object>} Chain info with last_irreversible_block_num
   */
  async getChainInfo() {
    try {
      const info = await this.makeRpcCall('/v1/chain/get_info');

      logger.debug('Got EOS chain info', {
        head_block_num: info.head_block_num,
        last_irreversible_block_num: info.last_irreversible_block_num
      });

      return {
        headBlockNum: info.head_block_num,
        lastIrreversibleBlockNum: info.last_irreversible_block_num,
        chainId: info.chain_id
      };
    } catch (error) {
      logger.error('Failed to get EOS chain info', { error: error.message });
      throw error;
    }
  }

  /**
   * Get a specific block by number
   * @param {number} blockNum - Block number
   * @returns {Promise<object>} Block data with block hash (id)
   */
  async getBlock(blockNum) {
    try {
      const block = await this.makeRpcCall('/v1/chain/get_block', {
        block_num_or_id: blockNum
      });

      logger.debug('Got EOS block', {
        block_num: block.block_num,
        id: block.id,
        timestamp: block.timestamp
      });

      return {
        blockNum: block.block_num,
        blockId: block.id, // This is the block hash
        timestamp: block.timestamp,
        producer: block.producer
      };
    } catch (error) {
      // Block might not exist yet
      if (error.response && error.response.status === 400) {
        return null;
      }

      logger.error('Failed to get EOS block', {
        error: error.message,
        block_num: blockNum
      });
      throw error;
    }
  }

  /**
   * Wait for a specific block to be produced
   * @param {number} targetBlockNum - Target block number
   * @param {number} maxWaitMs - Maximum wait time in milliseconds (default: 5 minutes)
   * @returns {Promise<object>} Block data
   */
  async waitForBlock(targetBlockNum, maxWaitMs = 300000) {
    const startTime = Date.now();
    const pollIntervalMs = 500; // Poll every 500ms

    logger.info('Waiting for EOS block', {
      target_block: targetBlockNum,
      max_wait_seconds: maxWaitMs / 1000
    });

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const block = await this.getBlock(targetBlockNum);

        if (block) {
          logger.info('EOS block produced', {
            block_num: block.blockNum,
            block_id: block.blockId,
            wait_time_seconds: (Date.now() - startTime) / 1000
          });
          return block;
        }

        // Block not yet produced, wait and try again
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        logger.error('Error while waiting for block', {
          error: error.message,
          target_block: targetBlockNum
        });
        throw error;
      }
    }

    throw new Error(
      `Timeout waiting for EOS block ${targetBlockNum} after ${maxWaitMs / 1000} seconds`
    );
  }

  /**
   * Get a future block hash for randomness
   * This is the main method used by the game manager
   *
   * @param {number} blocksInFuture - Number of blocks in the future (default: from env)
   * @returns {Promise<object>} { blockNum, blockHash, timestamp }
   */
  async getFutureBlockHash(blocksInFuture = null) {
    try {
      const offset = blocksInFuture || this.futureBlockOffset;

      logger.info('Fetching future EOS block hash', {
        blocks_in_future: offset
      });

      // Step 1: Get the latest irreversible block number
      const chainInfo = await this.getChainInfo();
      const targetBlockNum = chainInfo.lastIrreversibleBlockNum + offset;

      logger.info('Target block calculated', {
        last_irreversible: chainInfo.lastIrreversibleBlockNum,
        target_block: targetBlockNum,
        blocks_to_wait: offset
      });

      // Step 2: Wait for the target block to be produced
      const block = await this.waitForBlock(targetBlockNum);

      // Step 3: Convert block ID to 0x-prefixed hex string (for Solidity bytes32)
      const blockHash = block.blockId.startsWith('0x')
        ? block.blockId
        : '0x' + block.blockId;

      logger.info('Future block hash fetched successfully', {
        block_num: block.blockNum,
        block_hash: blockHash,
        timestamp: block.timestamp
      });

      return {
        blockNum: block.blockNum,
        blockHash: blockHash,
        timestamp: block.timestamp,
        producer: block.producer
      };
    } catch (error) {
      logger.error('Failed to get future block hash', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verify a block hash by fetching the block again
   * Used for auditing purposes
   *
   * @param {number} blockNum
   * @param {string} expectedHash
   * @returns {Promise<boolean>} True if hash matches
   */
  async verifyBlockHash(blockNum, expectedHash) {
    try {
      const block = await this.getBlock(blockNum);

      if (!block) {
        throw new Error(`Block ${blockNum} not found`);
      }

      const blockHash = block.blockId.startsWith('0x')
        ? block.blockId
        : '0x' + block.blockId;

      const matches = blockHash.toLowerCase() === expectedHash.toLowerCase();

      logger.info('Block hash verification', {
        block_num: blockNum,
        expected: expectedHash,
        actual: blockHash,
        matches
      });

      return matches;
    } catch (error) {
      logger.error('Failed to verify block hash', {
        error: error.message,
        block_num: blockNum
      });
      throw error;
    }
  }

  /**
   * Check if the service is initialized
   */
  isInitialized() {
    return this.initialized;
  }
}

module.exports = EosService;
