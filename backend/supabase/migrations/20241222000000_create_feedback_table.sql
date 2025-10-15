-- Create feedback table for user feedback system
-- This table stores user feedback, bug reports, and feature requests

CREATE TABLE IF NOT EXISTS feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'general')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    email TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    admin_notes TEXT
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_priority ON feedback(priority);

-- Enable Row Level Security
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anyone to insert feedback (anonymous submissions)
CREATE POLICY "Allow anonymous feedback submission" ON feedback
    FOR INSERT 
    WITH CHECK (true);

-- Create policy to allow reading all feedback (for admin dashboard)
-- In production, you might want to restrict this to admin users only
CREATE POLICY "Allow reading all feedback" ON feedback
    FOR SELECT
    USING (true);

-- Create policy to allow admins to update feedback status
-- In production, you'd check for admin role here
CREATE POLICY "Allow feedback updates" ON feedback
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Create function to automatically update updated_at column
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    IF NEW.status = 'resolved' AND OLD.status != 'resolved' THEN
        NEW.resolved_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
DROP TRIGGER IF EXISTS trigger_feedback_updated_at ON feedback;
CREATE TRIGGER trigger_feedback_updated_at
    BEFORE UPDATE ON feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_feedback_updated_at();

-- Insert some sample data for testing
INSERT INTO feedback (type, title, description, email, priority) VALUES
    ('feature', 'Add sound effects', 'Would love to hear some fun sounds when placing bets and when winning!', 'user@example.com', 'normal'),
    ('bug', 'Timer display issue', 'Sometimes the timer shows negative numbers', 'tester@test.com', 'high'),
    ('general', 'Love the VRF transparency!', 'The verify fairness feature is amazing - builds so much trust', 'fan@smolpot.com', 'low');

-- Create a view for admin dashboard statistics
CREATE OR REPLACE VIEW feedback_stats AS
SELECT 
    COUNT(*) as total_feedback,
    COUNT(*) FILTER (WHERE status = 'open') as open_count,
    COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count,
    COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
    COUNT(*) FILTER (WHERE type = 'bug') as bug_count,
    COUNT(*) FILTER (WHERE type = 'feature') as feature_count,
    COUNT(*) FILTER (WHERE type = 'general') as general_count,
    COUNT(*) FILTER (WHERE priority = 'critical') as critical_count,
    COUNT(*) FILTER (WHERE priority = 'high') as high_count,
    AVG(
        CASE 
            WHEN resolved_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (resolved_at - created_at))/3600 
        END
    ) as avg_resolution_time_hours
FROM feedback;