-- Extend users table for comprehensive profile management
-- Migration: 002_extend_user_profiles

-- Add missing columns to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS display_name TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS avatar_file_size INTEGER;

-- Add constraints
ALTER TABLE public.users 
ADD CONSTRAINT unique_username UNIQUE (username),
ADD CONSTRAINT unique_email UNIQUE (email),
ADD CONSTRAINT check_avatar_size CHECK (avatar_file_size IS NULL OR avatar_file_size <= 2097152); -- 2MB limit

-- Create index on wallet_address for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON public.users(wallet_address);

-- Create index on username for fast searches
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);

-- Update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON public.users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create a view for public user data (excludes email and sensitive info)
CREATE OR REPLACE VIEW public_user_profiles AS
SELECT 
    id,
    wallet_address,
    username,
    display_name,
    avatar_url,
    bio,
    created_at
FROM public.users
WHERE username IS NOT NULL; -- Only show users with usernames

-- Create function to get user profile by wallet address
CREATE OR REPLACE FUNCTION get_user_profile(wallet_addr TEXT)
RETURNS TABLE(
    id UUID,
    wallet_address TEXT,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    email TEXT,
    is_locked BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.wallet_address,
        u.username,
        u.display_name,
        u.avatar_url,
        u.bio,
        u.email,
        u.is_locked,
        u.created_at,
        u.updated_at
    FROM public.users u
    WHERE u.wallet_address = wallet_addr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check username availability
CREATE OR REPLACE FUNCTION is_username_available(desired_username TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1 FROM public.users 
        WHERE LOWER(username) = LOWER(desired_username)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update user profile (with restrictions)
CREATE OR REPLACE FUNCTION update_user_profile(
    user_wallet_address TEXT,
    new_username TEXT DEFAULT NULL,
    new_display_name TEXT DEFAULT NULL,
    new_avatar_url TEXT DEFAULT NULL,
    new_bio TEXT DEFAULT NULL,
    new_email TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    user_locked BOOLEAN;
    existing_user_id UUID;
BEGIN
    -- Get user info
    SELECT id, is_locked INTO existing_user_id, user_locked
    FROM public.users 
    WHERE wallet_address = user_wallet_address;
    
    IF existing_user_id IS NULL THEN
        RETURN FALSE; -- User not found
    END IF;
    
    IF user_locked THEN
        RETURN FALSE; -- User is locked from updates
    END IF;
    
    -- Update user profile
    UPDATE public.users SET
        username = COALESCE(new_username, username),
        display_name = COALESCE(new_display_name, display_name),
        avatar_url = COALESCE(new_avatar_url, avatar_url),
        bio = COALESCE(new_bio, bio),
        email = COALESCE(new_email, email),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = existing_user_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT SELECT ON public_user_profiles TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_profile(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_username_available(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_user_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;