-- SmolPot Database Schema
-- Hybrid Architecture with EOS Randomness
-- Created: October 15, 2025

-- ============================================
-- TABLES
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT UNIQUE NOT NULL,
    username TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Stats (denormalized for performance)
    total_bets BIGINT DEFAULT 0,
    total_wagered NUMERIC(78, 0) DEFAULT 0,  -- Up to 2^256 (wei)
    total_wins BIGINT DEFAULT 0,
    total_won NUMERIC(78, 0) DEFAULT 0,

    -- Constraints
    CONSTRAINT wallet_address_lowercase CHECK (wallet_address = LOWER(wallet_address))
);

-- Game rounds table
CREATE TABLE IF NOT EXISTS public.game_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pot_id TEXT NOT NULL,  -- On-chain pot ID from contract
    phase TEXT NOT NULL CHECK (phase IN ('IDLE', 'BETTING', 'LOCKED', 'COMPLETE')),

    -- Round timing
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    locked_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,

    -- Round data
    total_amount NUMERIC(78, 0) DEFAULT 0,  -- Total pot in wei
    total_tickets BIGINT DEFAULT 0,
    player_count INTEGER DEFAULT 0,

    -- Winner data
    winner_address TEXT,

    -- EOS randomness proof
    eos_block_number BIGINT,
    eos_block_hash TEXT,
    eos_timestamp TIMESTAMP WITH TIME ZONE,

    -- Transaction hashes
    start_tx_hash TEXT,
    lock_tx_hash TEXT,
    finish_tx_hash TEXT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT winner_address_lowercase CHECK (winner_address IS NULL OR winner_address = LOWER(winner_address)),
    CONSTRAINT eos_block_hash_format CHECK (eos_block_hash IS NULL OR eos_block_hash ~ '^0x[0-9a-f]{64}$')
);

-- Bets table
CREATE TABLE IF NOT EXISTS public.bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Bet data
    wallet_address TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,  -- Bet amount in wei
    ticket_start BIGINT,
    ticket_end BIGINT,

    -- Transaction data
    tx_hash TEXT NOT NULL,
    block_number BIGINT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT wallet_address_lowercase CHECK (wallet_address = LOWER(wallet_address)),
    CONSTRAINT amount_positive CHECK (amount > 0),
    CONSTRAINT tx_hash_format CHECK (tx_hash ~ '^0x[0-9a-f]{64}$')
);

-- EOS proofs table (for verification and auditing)
CREATE TABLE IF NOT EXISTS public.eos_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pot_id TEXT NOT NULL,

    -- EOS block data
    eos_block_number BIGINT NOT NULL,
    eos_block_hash TEXT NOT NULL,
    eos_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    eos_producer TEXT,

    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT eos_block_hash_format CHECK (eos_block_hash ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT unique_pot_proof UNIQUE (pot_id, eos_block_number)
);

-- ============================================
-- INDEXES
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON public.users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at DESC);

-- Game rounds indexes
CREATE INDEX IF NOT EXISTS idx_game_rounds_pot_id ON public.game_rounds(pot_id);
CREATE INDEX IF NOT EXISTS idx_game_rounds_phase ON public.game_rounds(phase);
CREATE INDEX IF NOT EXISTS idx_game_rounds_started_at ON public.game_rounds(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_rounds_winner ON public.game_rounds(winner_address);

-- Bets indexes
CREATE INDEX IF NOT EXISTS idx_bets_round_id ON public.bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON public.bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_wallet_address ON public.bets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_bets_created_at ON public.bets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_tx_hash ON public.bets(tx_hash);

-- EOS proofs indexes
CREATE INDEX IF NOT EXISTS idx_eos_proofs_pot_id ON public.eos_proofs(pot_id);
CREATE INDEX IF NOT EXISTS idx_eos_proofs_block_number ON public.eos_proofs(eos_block_number);

-- ============================================
-- VIEWS
-- ============================================

-- Active game round view
CREATE OR REPLACE VIEW public.active_game_round AS
SELECT *
FROM public.game_rounds
WHERE phase IN ('BETTING', 'LOCKED')
ORDER BY started_at DESC
LIMIT 1;

-- Leaderboard view (top players by wins)
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
    u.id,
    u.wallet_address,
    u.username,
    u.total_bets,
    u.total_wagered,
    u.total_wins,
    u.total_won,
    (u.total_won - u.total_wagered) AS net_profit,
    u.created_at
FROM public.users u
WHERE u.total_bets > 0
ORDER BY u.total_wins DESC, u.total_won DESC
LIMIT 100;

-- Recent rounds view
CREATE OR REPLACE VIEW public.recent_rounds AS
SELECT
    gr.*,
    COUNT(b.id) AS actual_bet_count,
    COUNT(DISTINCT b.wallet_address) AS unique_players
FROM public.game_rounds gr
LEFT JOIN public.bets b ON b.round_id = gr.id
WHERE gr.phase = 'COMPLETE'
GROUP BY gr.id
ORDER BY gr.finished_at DESC
LIMIT 50;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update game round totals when a bet is inserted
CREATE OR REPLACE FUNCTION update_game_round_totals()
RETURNS TRIGGER AS $$
BEGIN
    -- Update game round totals
    UPDATE public.game_rounds
    SET
        total_amount = total_amount + NEW.amount,
        total_tickets = total_tickets + (NEW.ticket_end - NEW.ticket_start + 1),
        player_count = (
            SELECT COUNT(DISTINCT wallet_address)
            FROM public.bets
            WHERE round_id = NEW.round_id
        ),
        updated_at = NOW()
    WHERE id = NEW.round_id;

    -- Update user stats
    UPDATE public.users
    SET
        total_bets = total_bets + 1,
        total_wagered = total_wagered + NEW.amount,
        updated_at = NOW()
    WHERE id = NEW.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update user stats when they win
CREATE OR REPLACE FUNCTION update_winner_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Only run if winner_address changed from NULL to a value
    IF OLD.winner_address IS NULL AND NEW.winner_address IS NOT NULL THEN
        UPDATE public.users
        SET
            total_wins = total_wins + 1,
            total_won = total_won + NEW.total_amount,
            updated_at = NOW()
        WHERE wallet_address = NEW.winner_address;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Trigger to update game round totals when bet is inserted
DROP TRIGGER IF EXISTS trigger_update_game_round_totals ON public.bets;
CREATE TRIGGER trigger_update_game_round_totals
    AFTER INSERT ON public.bets
    FOR EACH ROW
    EXECUTE FUNCTION update_game_round_totals();

-- Trigger to update winner stats when game finishes
DROP TRIGGER IF EXISTS trigger_update_winner_stats ON public.game_rounds;
CREATE TRIGGER trigger_update_winner_stats
    AFTER UPDATE ON public.game_rounds
    FOR EACH ROW
    EXECUTE FUNCTION update_winner_stats();

-- Trigger to update updated_at timestamp on users
DROP TRIGGER IF EXISTS trigger_update_users_updated_at ON public.users;
CREATE TRIGGER trigger_update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at timestamp on game_rounds
DROP TRIGGER IF EXISTS trigger_update_game_rounds_updated_at ON public.game_rounds;
CREATE TRIGGER trigger_update_game_rounds_updated_at
    BEFORE UPDATE ON public.game_rounds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eos_proofs ENABLE ROW LEVEL SECURITY;

-- Public read access policies
CREATE POLICY "Allow public read access to users"
    ON public.users FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access to game_rounds"
    ON public.game_rounds FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access to bets"
    ON public.bets FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access to eos_proofs"
    ON public.eos_proofs FOR SELECT
    USING (true);

-- Service role full access (backend uses service role key)
-- Service role bypasses RLS automatically, so no additional policies needed

-- ============================================
-- INITIAL DATA
-- ============================================

-- No initial data needed, tables will be populated by game manager

-- ============================================
-- GRANTS
-- ============================================

-- Grant necessary permissions to anon role (read-only)
GRANT SELECT ON public.users TO anon;
GRANT SELECT ON public.game_rounds TO anon;
GRANT SELECT ON public.bets TO anon;
GRANT SELECT ON public.eos_proofs TO anon;

-- Grant all permissions to authenticated users (same as anon for now)
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.game_rounds TO authenticated;
GRANT SELECT ON public.bets TO authenticated;
GRANT SELECT ON public.eos_proofs TO authenticated;

-- Views are readable by all
GRANT SELECT ON public.active_game_round TO anon, authenticated;
GRANT SELECT ON public.leaderboard TO anon, authenticated;
GRANT SELECT ON public.recent_rounds TO anon, authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.users IS 'Player profiles and statistics';
COMMENT ON TABLE public.game_rounds IS 'Game round history with EOS randomness proofs';
COMMENT ON TABLE public.bets IS 'Individual bet records linked to rounds and users';
COMMENT ON TABLE public.eos_proofs IS 'EOS blockchain randomness proofs for verification';

COMMENT ON VIEW public.active_game_round IS 'Current active game round (BETTING or LOCKED phase)';
COMMENT ON VIEW public.leaderboard IS 'Top 100 players by total wins';
COMMENT ON VIEW public.recent_rounds IS 'Last 50 completed game rounds with stats';

COMMENT ON FUNCTION update_game_round_totals() IS 'Updates game round totals when a bet is placed';
COMMENT ON FUNCTION update_winner_stats() IS 'Updates user stats when they win a round';
COMMENT ON FUNCTION update_updated_at_column() IS 'Updates the updated_at timestamp automatically';
