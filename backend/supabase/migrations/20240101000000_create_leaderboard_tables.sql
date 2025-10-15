-- Create leaderboard tables for SmolPot

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT UNIQUE NOT NULL,
    username TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pots table
CREATE TABLE IF NOT EXISTS pots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pot_number SERIAL,
    total_amount DECIMAL(20, 6) NOT NULL DEFAULT 0,
    winner_address TEXT,
    winner_amount DECIMAL(20, 6),
    fee_amount DECIMAL(20, 6),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled'))
);

-- Entries table
CREATE TABLE IF NOT EXISTS entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pot_id UUID REFERENCES pots(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(20, 6) NOT NULL,
    chance_percentage DECIMAL(5, 2),
    entered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Leaderboard table (activated after 1000 users)
CREATE TABLE IF NOT EXISTS leaderboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    total_wagered DECIMAL(20, 6) NOT NULL DEFAULT 0,
    total_won DECIMAL(20, 6) NOT NULL DEFAULT 0,
    pots_entered INTEGER DEFAULT 0,
    pots_won INTEGER DEFAULT 0,
    rank INTEGER,
    UNIQUE(user_id, week_start)
);

-- Statistics table
CREATE TABLE IF NOT EXISTS statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    total_pots INTEGER DEFAULT 0,
    total_volume DECIMAL(20, 6) DEFAULT 0,
    total_fees DECIMAL(20, 6) DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_entries_pot_id ON entries(pot_id);
CREATE INDEX idx_entries_user_id ON entries(user_id);
CREATE INDEX idx_leaderboard_week_start ON leaderboard(week_start);
CREATE INDEX idx_leaderboard_rank ON leaderboard(week_start, rank);
CREATE INDEX idx_pots_status ON pots(status);
CREATE INDEX idx_pots_started_at ON pots(started_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for users table
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for current week leaderboard
CREATE OR REPLACE VIEW current_week_leaderboard AS
SELECT 
    l.rank,
    u.username,
    u.wallet_address,
    u.avatar_url,
    l.total_wagered,
    l.total_won,
    l.pots_entered,
    l.pots_won
FROM leaderboard l
JOIN users u ON l.user_id = u.id
WHERE l.week_start = date_trunc('week', CURRENT_DATE)
ORDER BY l.rank;

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pots ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE statistics ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Public users are viewable by everyone" ON users
    FOR SELECT USING (true);

CREATE POLICY "Public pots are viewable by everyone" ON pots
    FOR SELECT USING (true);

CREATE POLICY "Public entries are viewable by everyone" ON entries
    FOR SELECT USING (true);

CREATE POLICY "Public leaderboard is viewable by everyone" ON leaderboard
    FOR SELECT USING (true);

CREATE POLICY "Public statistics are viewable by everyone" ON statistics
    FOR SELECT USING (true);