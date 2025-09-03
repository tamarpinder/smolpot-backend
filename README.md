# SmolPot Backend Services

Backend services for SmolPot including automation, database migrations, and Supabase configuration.

## Structure

```
SmolPot-Backend/
├── automation/     # 24/7 pot monitoring and winner drawing automation
├── backend/        # Supabase configuration and API endpoints  
└── database/       # Database migrations and schema
```

## Components

### Automation Service
- **Path**: `automation/`
- **Purpose**: 24/7 monitoring and automatic winner drawing
- **Deployment**: Railway (configure root directory to `automation/`)
- **Technologies**: Node.js, Ethers.js, PM2
- **Features**: 
  - Real-time pot monitoring with 3-second intervals
  - Automatic winner drawing when timer expires
  - Health monitoring and error recovery
  - Comprehensive logging system

### Backend API
- **Path**: `backend/`
- **Purpose**: Supabase configuration and database management
- **Technologies**: Supabase, SQL, Node.js
- **Features**:
  - Database schema for leaderboards and game history
  - Real-time subscriptions for live updates
  - API endpoints for frontend integration

### Database
- **Path**: `database/`
- **Purpose**: Database migrations and schema management
- **Features**:
  - User profile extensions
  - Game history tracking
  - Leaderboard management

## Deployment

### Railway Configuration
When deploying the automation service to Railway:

1. **Root Directory**: Set to `automation/`
2. **Start Command**: `npm start` or `npm run automation`
3. **Environment Variables**: Configure all required variables from `automation/.env.example`

### Environment Setup
Copy `automation/.env.example` to `automation/.env` and configure:
```bash
# Blockchain Configuration
PRIVATE_KEY=your_wallet_private_key
RPC_URL=https://api.testnet.abs.xyz
CONTRACT_ADDRESS=your_contract_address

# Monitoring Configuration  
MONITOR_INTERVAL=3000
HEALTH_CHECK_PORT=3000
```

## Development

```bash
# Install automation dependencies
cd automation && npm install

# Run automation locally
npm run dev

# Run with PM2 (production)
npm run start
```

## Related Repositories
- **Frontend**: https://github.com/tamarpinder/smolpot-frontend.git
- **Admin Panel**: https://github.com/tamarpinder/solpot-admin.git
- **Contracts**: SmolPot-Contracts (local development)