-- Seed data for development and testing

-- Insert sample users
INSERT INTO users (wallet_address, username, avatar_url) VALUES
    ('cosmos1abc123def456', 'SmolWhale', 'https://api.dicebear.com/7.x/avataaars/svg?seed=whale'),
    ('cosmos1ghi789jkl012', 'LuckyDegen', 'https://api.dicebear.com/7.x/avataaars/svg?seed=lucky'),
    ('cosmos1mno345pqr678', 'MoonBoi', 'https://api.dicebear.com/7.x/avataaars/svg?seed=moon'),
    ('cosmos1stu901vwx234', 'DiamondHands', 'https://api.dicebear.com/7.x/avataaars/svg?seed=diamond'),
    ('cosmos1yza567bcd890', 'PaperHands', 'https://api.dicebear.com/7.x/avataaars/svg?seed=paper');

-- Note: Additional test data can be added here for development purposes