# SmolPot Backend Automation Service

**Automated winner drawing service with worker wallet for 24/7 lottery operation**

## 🚀 Overview

This service provides complete automation for the SmolPot lottery system by:
- Monitoring the SmolPotCore contract continuously
- Automatically drawing winners when conditions are met
- Managing worker wallet gas and balance
- Providing notifications and monitoring via Discord
- Ensuring 24/7 reliable operation with PM2

## 📋 Features

### ✅ Core Automation
- **Automatic Winner Drawing**: Draws winners when timer expires and minimum participants met
- **Gas Management**: Intelligent gas price estimation with configurable buffers
- **Error Handling**: Robust retry logic and error recovery
- **Balance Monitoring**: Automatic alerts when worker wallet needs funding

### 📊 Monitoring & Alerts
- **Discord Notifications**: Real-time alerts for all important events
- **Health Checks**: Automated system health reporting
- **Performance Stats**: Regular statistics and uptime reports
- **Error Tracking**: Detailed error logging and consecutive error alerts

### 🛡️ Security & Reliability  
- **Worker Wallet**: Dedicated wallet for automated transactions
- **Rate Limiting**: Cooldown periods to prevent notification spam
- **Process Management**: PM2 integration for auto-restart and monitoring
- **Graceful Shutdown**: Clean shutdown handling with final notifications

## 📥 Installation

### Prerequisites
- Node.js 18+
- npm or yarn
- PM2 (for production deployment)

### Setup
```bash
# Navigate to automation directory
cd automation

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Configure environment variables (see Configuration section)
nano .env

# Create logs directory
mkdir logs

# Install PM2 globally (for production)
npm install -g pm2
```

## ⚙️ Configuration

### 1. Environment Variables

Edit `.env` file with your configuration:

```bash
# ===============================================
# BLOCKCHAIN CONFIGURATION
# ===============================================
RPC_URL=https://api.testnet.abs.xyz
CONTRACT_ADDRESS=0x556243315999c079d3f1b2326d0ee508f6d92fc8

# ===============================================
# WORKER WALLET CONFIGURATION
# ===============================================
WORKER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
MIN_WORKER_BALANCE=0.01

# ===============================================
# NOTIFICATION CONFIGURATION
# ===============================================
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE
```

### 2. Worker Wallet Setup

**CRITICAL SECURITY STEPS:**

1. **Create Dedicated Wallet**: 
   - Generate a new wallet specifically for automation
   - Never use your personal wallet or main project wallet

2. **Fund the Wallet**:
   - Transfer ETH for gas costs (recommended: 0.05+ ETH initially)
   - Monitor balance regularly through Discord notifications

3. **Secure Private Key**:
   - Store private key in `.env` file (never commit to git)
   - Consider using hardware wallet or key management service in production

### 3. Discord Notifications Setup

1. Create Discord webhook in your server:
   - Server Settings → Integrations → Webhooks → New Webhook
   - Copy webhook URL to `DISCORD_WEBHOOK_URL` in `.env`

2. The service will send notifications for:
   - 🚀 Service startup/shutdown
   - 🎉 Winner drawings
   - ⚠️ Errors and alerts
   - 💰 Low balance warnings
   - 📊 Health checks and stats

## 🏃 Usage

### Development Mode
```bash
# Run in development with auto-restart
npm run dev

# Or run once
npm start
```

### Production Deployment
```bash
# Start with PM2 process manager
npm run monitor

# Check status
pm2 status

# View real-time logs
npm run logs

# Stop service
npm run stop

# Restart service
pm2 restart smolpot-automation
```

### PM2 Commands
```bash
# View detailed process info
pm2 show smolpot-automation

# Monitor resource usage
pm2 monit

# View log files
pm2 logs smolpot-automation --lines 100

# Flush logs
pm2 flush smolpot-automation
```

## 📊 Monitoring

### Real-time Monitoring
The service provides comprehensive monitoring through:

1. **Console Logs**: Detailed logging to console and files
2. **Discord Notifications**: Real-time alerts and reports
3. **PM2 Dashboard**: Process health and resource usage
4. **Log Files**: Persistent logging in `logs/` directory

### Key Metrics Tracked
- ✅ Monitoring checks performed
- 🎉 Winners drawn successfully  
- ❌ Errors encountered
- 💰 Worker wallet balance
- ⏰ Service uptime
- 🕐 Last activity timestamp

### Notification Types
| Event | Description | Frequency |
|-------|-------------|-----------|
| 🚀 Startup | Service initialization | Once per start |
| 🔴 Shutdown | Service shutdown | Once per stop |
| 🎉 Winner Drawn | Successful winner selection | Per winner |
| ⚠️ Error | Non-critical errors | Rate limited |
| 🚨 Critical Error | Service-stopping errors | Immediate |
| 💰 Low Balance | Worker wallet needs funding | Every 30 min |
| 💚 Health Check | System status report | Every hour |
| 📊 Stats Report | Performance statistics | Every 6 hours |

## 🛠️ Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check environment configuration
node -e "require('dotenv').config(); console.log(process.env.WORKER_PRIVATE_KEY ? 'Key loaded' : 'Key missing')"

# Verify contract connection
node -e "const {ethers} = require('ethers'); const provider = new ethers.JsonRpcProvider(process.env.RPC_URL); provider.getNetwork().then(n => console.log('Connected to:', n.chainId))"

# Check worker balance
node -e "const {ethers} = require('ethers'); require('dotenv').config(); const provider = new ethers.JsonRpcProvider(process.env.RPC_URL); const wallet = new ethers.Wallet(process.env.WORKER_PRIVATE_KEY, provider); provider.getBalance(wallet.address).then(b => console.log('Balance:', ethers.formatEther(b), 'ETH'))"
```

#### Transaction Failures
- **Insufficient Balance**: Fund worker wallet with more ETH
- **Gas Issues**: Check if Abstract testnet is experiencing issues
- **Contract State**: Verify contract is active and not paused

#### No Discord Notifications
- **Webhook URL**: Verify Discord webhook URL is correct
- **Permissions**: Ensure webhook has message sending permissions
- **Rate Limits**: Check if hitting Discord rate limits

### Log Analysis
```bash
# View recent errors
tail -f logs/error.log

# Search for specific issues
grep -i "failed to draw winner" logs/combined.log

# Monitor real-time activity
tail -f logs/combined.log | grep -E "(Winner|Error|Balance)"
```

## 💰 Cost Analysis

### Operational Costs (Abstract Testnet)
- **Gas per winner draw**: ~0.001-0.003 ETH
- **Daily cost** (10 winners): ~0.01-0.03 ETH
- **Monthly cost**: ~0.3-0.9 ETH (~$300-900 at $1000 ETH)

### Recommended Funding
- **Initial funding**: 0.1 ETH
- **Monthly top-up**: 0.5-1.0 ETH depending on activity
- **Low balance alert**: 0.01 ETH (configurable)

### Cost Optimization
- Monitor gas prices and adjust buffers
- Use efficient gas estimation
- Batch operations when possible
- Consider Layer 2 scaling solutions

## 🔐 Security Best Practices

### Worker Wallet Security
1. **Dedicated Wallet**: Never use personal or main project wallets
2. **Minimal Funding**: Keep only necessary ETH for operations
3. **Key Management**: Use environment variables, never hardcode keys
4. **Access Control**: Limit who has access to private keys
5. **Monitoring**: Set up balance and transaction alerts

### Operational Security
1. **Server Security**: Keep automation server updated and secured
2. **Backup Strategy**: Backup configuration and logs regularly  
3. **Monitoring**: Monitor for unusual transaction patterns
4. **Emergency Procedures**: Have plan for stopping service if compromised

### Environment Security
```bash
# Set proper file permissions
chmod 600 .env
chmod 700 logs/

# Never commit sensitive files
echo ".env" >> .gitignore
echo "logs/" >> .gitignore
```

## 🚦 Service States

The automation service operates in several states:

### 🟢 Normal Operation
- Monitoring contract every 10 seconds
- Worker balance sufficient (>0.01 ETH)
- No recent errors
- Discord notifications working

### 🟡 Warning States
- Low worker balance (0.005-0.01 ETH)
- Occasional transaction failures
- High gas prices causing delays
- Discord webhook issues

### 🔴 Critical States  
- Worker balance critically low (<0.005 ETH)
- Multiple consecutive transaction failures
- Service cannot connect to RPC
- Contract appears to be paused/broken

### 🔴 Service Shutdown States
- Critical errors exceed threshold
- Worker wallet completely drained
- Unhandled exceptions
- Manual shutdown requested

## 🔄 Maintenance

### Regular Tasks
1. **Monitor Balance**: Check worker wallet weekly
2. **Review Logs**: Check error logs for issues
3. **Update Dependencies**: Keep packages updated
4. **Test Notifications**: Verify Discord alerts working
5. **Backup Configuration**: Keep `.env` file backed up securely

### Monthly Tasks
1. **Performance Review**: Analyze winner drawing stats
2. **Cost Analysis**: Review gas costs and efficiency
3. **Security Audit**: Review access and permissions
4. **Service Updates**: Update automation service if needed

### Scaling Considerations
- Multiple worker wallets for redundancy
- Load balancing across multiple RPC endpoints
- Geographic distribution for reliability
- Integration with monitoring services (DataDog, etc.)

## 📞 Support

### Getting Help
1. **Check Logs**: Always check `logs/error.log` first
2. **Discord Notifications**: Review recent Discord alerts
3. **PM2 Status**: Check process manager status
4. **Contract Status**: Verify contract is operational

### Useful Commands
```bash
# Full system status
pm2 status && echo "Recent errors:" && tail -n 5 logs/error.log

# Restart with clean state
pm2 stop smolpot-automation && pm2 delete smolpot-automation && npm run monitor

# Emergency stop
pm2 stop smolpot-automation

# View performance metrics
pm2 monit
```

---

**⚡ Built for SmolPot - Automated Lottery Excellence**

**🔧 Service Status**: Production Ready  
**📅 Last Updated**: August 30, 2025  
**👨‍💻 Maintainer**: SmolPot Team