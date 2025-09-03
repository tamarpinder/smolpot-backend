const http = require('http');

// Simple health check server for Railway
class HealthCheckServer {
  constructor(logger, getStats) {
    this.logger = logger;
    this.getStats = getStats;
    this.server = null;
    this.port = process.env.PORT || 3000;
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        const stats = this.getStats();
        const uptime = Math.floor((Date.now() - stats.uptime) / 1000);
        
        const response = {
          status: 'healthy',
          service: 'smolpot-automation',
          uptime: uptime,
          monitored: stats.monitored,
          winnersDrawn: stats.winnersDrawn,
          errors: stats.errors,
          lastActivity: stats.lastActivity
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info(`🏥 Health check server listening on port ${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.logger.info('🏥 Health check server stopped');
    }
  }
}

module.exports = { HealthCheckServer };