#!/bin/bash

# SmolPot Automation Service Setup Script
# This script helps set up the automation service for the first time

set -e

echo "🚀 SmolPot Automation Service Setup"
echo "====================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function for colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if we're in the automation directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the automation directory"
    exit 1
fi

print_info "Checking prerequisites..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version $NODE_VERSION is too old. Please upgrade to Node.js 18+."
    exit 1
fi

print_status "Node.js $(node -v) detected"

# Check for npm
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed"
    exit 1
fi

print_status "npm $(npm -v) detected"

# Install dependencies
print_info "Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    print_status "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
    exit 1
fi

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    print_info "Installing PM2 process manager globally..."
    npm install -g pm2
    
    if [ $? -eq 0 ]; then
        print_status "PM2 installed successfully"
    else
        print_warning "Failed to install PM2 globally. You may need to run: sudo npm install -g pm2"
    fi
else
    print_status "PM2 $(pm2 -v) already installed"
fi

# Create logs directory
if [ ! -d "logs" ]; then
    mkdir logs
    print_status "Created logs directory"
else
    print_status "Logs directory already exists"
fi

# Set up environment file
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_status "Created .env file from template"
        print_warning "IMPORTANT: You must edit .env file with your configuration before running the service"
    else
        print_error ".env.example file not found"
        exit 1
    fi
else
    print_warning ".env file already exists - skipping template copy"
fi

# Set proper permissions
chmod 600 .env 2>/dev/null || print_warning "Could not set .env permissions (this is okay)"
chmod 700 logs 2>/dev/null || print_warning "Could not set logs directory permissions (this is okay)"

print_status "File permissions configured"

# Validate environment template
print_info "Validating environment configuration..."

if grep -q "YOUR_PRIVATE_KEY_HERE" .env; then
    print_error "Please edit .env file and replace YOUR_PRIVATE_KEY_HERE with your actual worker wallet private key"
    NEEDS_CONFIG=true
fi

if grep -q "YOUR_WEBHOOK_HERE" .env; then
    print_warning "Please edit .env file and add your Discord webhook URL (optional but recommended)"
    NEEDS_CONFIG=true
fi

# Check if all required variables exist
REQUIRED_VARS=("RPC_URL" "CONTRACT_ADDRESS" "WORKER_PRIVATE_KEY" "MIN_WORKER_BALANCE")
for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=" .env; then
        print_error "Missing required variable: $var"
        NEEDS_CONFIG=true
    fi
done

echo ""
echo "🎯 Setup Summary"
echo "================"
print_status "Dependencies installed"
print_status "PM2 process manager ready"
print_status "Logs directory created"
print_status "Environment file configured"

if [ "$NEEDS_CONFIG" = true ]; then
    echo ""
    print_warning "CONFIGURATION REQUIRED:"
    print_info "1. Edit .env file with your settings:"
    echo "   nano .env"
    echo ""
    print_info "2. Required configurations:"
    echo "   - WORKER_PRIVATE_KEY: Private key for automation wallet"
    echo "   - Verify RPC_URL and CONTRACT_ADDRESS are correct"
    echo "   - Optional: DISCORD_WEBHOOK_URL for notifications"
    echo ""
    print_info "3. Fund your worker wallet with ETH for gas costs"
    echo ""
    print_warning "DO NOT START THE SERVICE UNTIL CONFIGURATION IS COMPLETE"
else
    print_status "Configuration appears complete"
fi

echo ""
echo "🚀 Next Steps"
echo "============="
print_info "Development mode:"
echo "   npm run dev"
echo ""
print_info "Production mode:"
echo "   npm run monitor"
echo ""
print_info "View logs:"
echo "   npm run logs"
echo ""
print_info "Stop service:"
echo "   npm run stop"
echo ""

echo "📚 For detailed instructions, see README.md"
echo ""

# Test basic configuration if complete
if [ "$NEEDS_CONFIG" != true ]; then
    print_info "Running basic configuration test..."
    
    # Test environment loading
    if node -e "require('dotenv').config(); console.log('Environment loaded successfully')" 2>/dev/null; then
        print_status "Environment configuration valid"
        
        # Test RPC connection
        if node -e "
            const {ethers} = require('ethers');
            require('dotenv').config();
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            provider.getNetwork()
                .then(n => console.log('RPC connection successful, Chain ID:', n.chainId))
                .catch(e => { console.error('RPC connection failed:', e.message); process.exit(1); })
        " 2>/dev/null; then
            print_status "RPC connection test passed"
        else
            print_error "RPC connection test failed - please check RPC_URL"
        fi
        
        # Test worker wallet
        if node -e "
            const {ethers} = require('ethers');
            require('dotenv').config();
            try {
                const wallet = new ethers.Wallet(process.env.WORKER_PRIVATE_KEY);
                console.log('Worker wallet loaded:', wallet.address);
            } catch(e) {
                console.error('Invalid private key');
                process.exit(1);
            }
        " 2>/dev/null; then
            print_status "Worker wallet configuration valid"
        else
            print_error "Worker wallet configuration invalid - please check WORKER_PRIVATE_KEY"
        fi
        
    else
        print_error "Environment configuration test failed"
    fi
fi

echo ""
print_status "Setup complete! 🎉"

if [ "$NEEDS_CONFIG" = true ]; then
    print_warning "Remember to complete configuration before starting the service"
else
    print_info "Service is ready to start with: npm run monitor"
fi