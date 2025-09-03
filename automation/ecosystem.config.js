module.exports = {
  apps: [
    {
      name: 'smolpot-automation',
      script: 'index.js',
      
      // Instance configuration
      instances: 1, // Single instance to avoid conflicts
      exec_mode: 'fork', // Fork mode for single instance
      
      // Auto-restart configuration
      autorestart: true,
      watch: false, // Disable watch in production
      max_memory_restart: '500M', // Restart if memory exceeds 500MB
      
      // Restart strategy
      restart_delay: 5000, // Wait 5 seconds between restarts
      max_restarts: 10, // Maximum 10 restarts per minute
      min_uptime: '30s', // Minimum uptime before considering successful
      
      // Environment
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        DEBUG_MODE: 'true'
      },
      
      // Logging
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Advanced PM2 features
      ignore_watch: ['node_modules', 'logs', '.git'],
      
      // Cron-like restart (optional - restart daily at 3 AM)
      cron_restart: '0 3 * * *',
      
      // Health monitoring
      kill_timeout: 5000, // 5 seconds to gracefully stop
      listen_timeout: 8000, // 8 seconds to start
      
      // Additional PM2 configuration
      merge_logs: true,
      time: true // Prefix logs with timestamps
    }
  ],

  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/smolpot.git',
      path: '/var/www/smolpot-automation',
      'post-deploy': 'cd automation && npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
};