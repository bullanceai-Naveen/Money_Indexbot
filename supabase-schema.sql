-- ============================================
-- MoneyIndex - Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. USER PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    phone TEXT,
    subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('inactive', 'active', 'expired')),
    subscription_start TIMESTAMPTZ,
    subscription_end TIMESTAMPTZ,
    razorpay_customer_id TEXT,
    telegram_chat_id TEXT,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status ON profiles(subscription_status);

-- ============================================
-- 2. AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 3. PAYMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    razorpay_order_id TEXT UNIQUE,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    amount INTEGER NOT NULL, -- in paise (49900 = ₹499)
    currency TEXT DEFAULT 'INR',
    status TEXT DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ============================================
-- 4. ACCESS TOKENS (encrypted Upstox tokens)
-- ============================================
CREATE TABLE IF NOT EXISTS access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_encrypted TEXT NOT NULL,
    token_name TEXT DEFAULT 'primary',
    is_active BOOLEAN DEFAULT true,
    last_used TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_active ON access_tokens(is_active);

-- ============================================
-- 5. CONTACT MESSAGES
-- ============================================
CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON contact_messages(status);

-- ============================================
-- 6. USER ACTIVITY (for analytics & rate limiting)
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,
    metadata JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_action ON user_activity(user_id, action);
CREATE INDEX IF NOT EXISTS idx_activity_created ON user_activity(created_at);

-- ============================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean re-run)
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins full access to profiles" ON profiles;
DROP POLICY IF EXISTS "Users view own payments" ON payments;
DROP POLICY IF EXISTS "Admins full access to payments" ON payments;
DROP POLICY IF EXISTS "Anyone can send messages" ON contact_messages;
DROP POLICY IF EXISTS "Users can view own messages" ON contact_messages;
DROP POLICY IF EXISTS "Admins full access to messages" ON contact_messages;
DROP POLICY IF EXISTS "Only service role can access tokens" ON access_tokens;
DROP POLICY IF EXISTS "Users can insert own activity" ON user_activity;
DROP POLICY IF EXISTS "Users can view own activity" ON user_activity;

-- PROFILES POLICIES
-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile (but not subscription or admin status)
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id AND
        -- Prevent users from modifying these fields themselves
        (subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM profiles WHERE id = auth.uid())) AND
        (is_admin IS NOT DISTINCT FROM (SELECT is_admin FROM profiles WHERE id = auth.uid()))
    );

-- Admins can do everything with profiles
CREATE POLICY "Admins full access to profiles" ON profiles
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- PAYMENTS POLICIES
-- Users can view their own payments
CREATE POLICY "Users view own payments" ON payments
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can do everything with payments
CREATE POLICY "Admins full access to payments" ON payments
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- CONTACT MESSAGES POLICIES
-- Anyone can insert messages
CREATE POLICY "Anyone can send messages" ON contact_messages
    FOR INSERT WITH CHECK (true);

-- Users can view their own messages
CREATE POLICY "Users can view own messages" ON contact_messages
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

-- Admins can do everything with messages
CREATE POLICY "Admins full access to messages" ON contact_messages
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ACCESS TOKENS POLICIES
-- Only service role (backend) can access tokens
-- Regular users and admins cannot access tokens through client
CREATE POLICY "Only service role can access tokens" ON access_tokens
    FOR ALL USING (false); -- Deny all client access, only service_role can access

-- USER ACTIVITY POLICIES
-- Users can view their own activity
CREATE POLICY "Users can view own activity" ON user_activity
    FOR SELECT USING (auth.uid() = user_id);

-- System can insert activity (through service role)
-- Note: Activity insertion is done server-side via service_role key

-- ============================================
-- 8. CREATE FIRST ADMIN USER (OPTIONAL)
-- Run this AFTER you've signed up with your admin email
-- Replace 'your-admin@email.com' with your actual email
-- ============================================

-- UPDATE profiles
-- SET is_admin = true
-- WHERE email = 'your-admin@email.com';

-- ============================================
-- 9. HELPER FUNCTIONS
-- ============================================

-- Function to check if user has active subscription
CREATE OR REPLACE FUNCTION has_active_subscription(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    is_active BOOLEAN;
BEGIN
    SELECT
        (subscription_status = 'active' AND subscription_end > NOW())
    INTO is_active
    FROM profiles
    WHERE id = user_uuid;

    RETURN COALESCE(is_active, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to activate subscription
CREATE OR REPLACE FUNCTION activate_subscription(user_uuid UUID, days INTEGER DEFAULT 30)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles
    SET
        subscription_status = 'active',
        subscription_start = NOW(),
        subscription_end = NOW() + (days || ' days')::INTERVAL,
        updated_at = NOW()
    WHERE id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. CLEANUP OLD DATA (Optional scheduled job)
-- Can be run manually or via pg_cron if available
-- ============================================

-- Delete activity logs older than 90 days
-- DELETE FROM user_activity WHERE created_at < NOW() - INTERVAL '90 days';

-- ============================================
-- SCHEMA COMPLETE!
-- ============================================

-- After running this:
-- 1. Go to Authentication > Settings in Supabase dashboard
-- 2. Enable Email provider if not already enabled
-- 3. Optionally disable email confirmation for testing
-- 4. Copy your Project URL and anon key to your .env file
-- 5. Create your admin account by signing up, then run:
--    UPDATE profiles SET is_admin = true WHERE email = 'your@email.com';
