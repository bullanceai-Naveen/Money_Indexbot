# MoneyIndex - Complete Deployment & Security Plan

## Key Principle: Local System Remains Unchanged

Your current FastAPI + SQLite system will continue working exactly as it does now for local development. The deployment infrastructure is **additive** - it sits alongside your existing code without modifying it.

```
FOLDER STRUCTURE (Both systems coexist):

MoneyIndex/
├── ─────────────── EXISTING (UNCHANGED) ───────────────
├── server.py              # Your current FastAPI server (LOCAL)
├── config.py              # Current config (LOCAL)
├── init_db.py             # SQLite initialization (LOCAL)
├── run.py                 # Local startup script (LOCAL)
├── requirements.txt       # Python dependencies (LOCAL)
├── index_scanner.db       # SQLite database (LOCAL)
├── static/                # Current frontend (LOCAL)
│   ├── index.html
│   ├── app.js
│   ├── charts.js
│   └── styles.css
│
├── ─────────────── NEW (DEPLOYMENT) ───────────────
├── netlify/               # Netlify serverless functions
│   └── functions/
├── public/                # Netlify frontend (production)
│   ├── index.html         # Landing page
│   ├── login.html
│   ├── dashboard.html     # Calls your existing static/ files
│   └── ...
├── netlify.toml           # Netlify config
├── package.json           # Node.js dependencies (deployment)
└── .env.example           # Environment variables template
```

**How it works:**
- Run `python run.py` → Your current local system works as before
- Push to GitHub → Netlify builds and deploys the production version
- Both are independent, both work simultaneously

---

## Executive Summary

Transform the current options monitoring dashboard into a secure, monetized SaaS product:

| Feature | Solution | Cost |
|---------|----------|------|
| Hosting | Netlify (free tier) | ₹0 |
| Database | Supabase PostgreSQL | ₹0 |
| Authentication | Supabase Auth | ₹0 |
| Payment Gateway | Razorpay | ~₹12/sale |
| Email | Resend.com | ₹0 |
| Telegram Bot | Telegram API | ₹0 |
| **Total Monthly** | | **₹0 + ₹12/sale** |

---

## Architecture Overview

### Current System (Local Development)
```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│ Upstox API  │────▶│ FastAPI Server  │────▶│ SQLite DB   │
└─────────────┘     │ (server.py)     │     │ (local file)│
                    └────────┬────────┘     └─────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ static/         │
                    │ (Vanilla JS)    │
                    └─────────────────┘

Run: python run.py
Access: http://localhost:8001
```

### Production System (Netlify Deployment)
```
                                    ┌──────────────────────────┐
                                    │   SUPABASE (Free Tier)   │
                                    │   ├─ PostgreSQL DB       │
                                    │   ├─ Authentication      │
                                    │   └─ Row Level Security  │
                                    └────────────┬─────────────┘
                                                 │
┌─────────────┐    ┌───────────────────────────────────────────────────────┐
│ Upstox API  │───▶│              NETLIFY (Free Tier)                      │
└─────────────┘    │   ┌─────────────────────────────────────────────────┐ │
                   │   │  Serverless Functions (Backend)                 │ │
┌─────────────┐    │   │  ├─ /api/auth/* (authentication)                │ │
│ Razorpay    │◀──▶│   │  ├─ /api/payment/* (Razorpay)                   │ │
└─────────────┘    │   │  ├─ /api/market/* (proxied market data)         │ │
                   │   │  ├─ /api/admin/* (admin operations)             │ │
┌─────────────┐    │   │  └─ /api/contact/* (email)                      │ │
│ Telegram    │◀──▶│   └─────────────────────────────────────────────────┘ │
└─────────────┘    │                         │                             │
                   │   ┌─────────────────────▼───────────────────────────┐ │
┌─────────────┐    │   │  Static Frontend (public/)                      │ │
│ Resend.com  │◀──▶│   │  ├─ Landing, Pricing, Login (public)            │ │
│ (Email)     │    │   │  └─ Dashboard, Profile, Admin (protected)       │ │
└─────────────┘    │   └─────────────────────────────────────────────────┘ │
                   └───────────────────────────────────────────────────────┘

Deploy: git push (auto-deploys)
Access: https://yourapp.netlify.app
```

---

## Phase 1: Database Setup (Supabase)

### 1.1 Why Supabase Instead of SQLite for Production

| SQLite (Current) | Supabase (Production) |
|------------------|----------------------|
| Resets on each deploy | Persistent data |
| No user auth | Built-in authentication |
| Single file, no backup | Automatic backups |
| No access control | Row Level Security |
| Local only | Cloud accessible |

### 1.2 Create Supabase Project

1. Go to https://supabase.com
2. Create free account
3. Create new project (choose Singapore region for India)
4. Note down:
   - Project URL: `https://xxxx.supabase.co`
   - Anon Key: `eyJxxxx...` (public, safe for frontend)
   - Service Key: `eyJxxxx...` (secret, backend only)

### 1.3 Database Schema

Run this SQL in Supabase SQL Editor:

```sql
-- ============================================
-- USER PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE profiles (
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

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- PAYMENTS
-- ============================================
CREATE TABLE payments (
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

-- ============================================
-- ACCESS TOKENS (encrypted Upstox tokens)
-- ============================================
CREATE TABLE access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_encrypted TEXT NOT NULL,
    token_name TEXT DEFAULT 'primary',
    is_active BOOLEAN DEFAULT true,
    last_used TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTACT MESSAGES
-- ============================================
CREATE TABLE contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- USER ACTIVITY (for analytics & rate limiting)
-- ============================================
CREATE TABLE user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,
    metadata JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX idx_activity_user_action ON user_activity(user_id, action, created_at);

-- ============================================
-- MARKET DATA TABLES (same as your SQLite schema)
-- ============================================
CREATE TABLE index_spot_history (
    id BIGSERIAL PRIMARY KEY,
    index_name TEXT NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    spot_price DECIMAL(12,2),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE strike_oi_live (
    id BIGSERIAL PRIMARY KEY,
    index_name TEXT NOT NULL,
    date DATE NOT NULL,
    strike INTEGER NOT NULL,
    ce_oi INTEGER,
    pe_oi INTEGER,
    ce_volume INTEGER,
    pe_volume INTEGER,
    ce_iv DECIMAL(8,4),
    pe_iv DECIMAL(8,4),
    ce_ltp DECIMAL(12,2),
    pe_ltp DECIMAL(12,2),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(index_name, date, strike)
);

CREATE TABLE strike_oi_timeseries (
    id BIGSERIAL PRIMARY KEY,
    index_name TEXT NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    spot_price DECIMAL(12,2),
    weighted_net_score DECIMAL(10,4),
    bullish_value DECIMAL(12,2),
    bearish_value DECIMAL(12,2),
    pcr DECIMAL(8,4),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pcr_history (
    id BIGSERIAL PRIMARY KEY,
    index_name TEXT NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    pcr DECIMAL(8,4),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE support_resistance (
    id BIGSERIAL PRIMARY KEY,
    index_name TEXT NOT NULL,
    date DATE NOT NULL,
    level_type TEXT NOT NULL,
    strike INTEGER NOT NULL,
    strength DECIMAL(8,4),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE max_pain_history (
    id BIGSERIAL PRIMARY KEY,
    index_name TEXT NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    max_pain_strike INTEGER NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Users can only see their own payments
CREATE POLICY "Users can view own payments" ON payments
    FOR SELECT USING (auth.uid() = user_id);

-- Users can view their own messages
CREATE POLICY "Users can view own messages" ON contact_messages
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert messages
CREATE POLICY "Anyone can send messages" ON contact_messages
    FOR INSERT WITH CHECK (true);

-- Admins can see everything (using is_admin flag)
CREATE POLICY "Admins full access to profiles" ON profiles
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

CREATE POLICY "Admins full access to payments" ON payments
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

CREATE POLICY "Admins full access to messages" ON contact_messages
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- Market data is readable by active subscribers only
ALTER TABLE index_spot_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE strike_oi_live ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active subscribers can read market data" ON index_spot_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND subscription_status = 'active'
            AND subscription_end > NOW()
        )
    );

CREATE POLICY "Active subscribers can read strike data" ON strike_oi_live
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND subscription_status = 'active'
            AND subscription_end > NOW()
        )
    );
```

---

## Phase 2: Netlify Project Setup

### 2.1 Initialize Node.js Project

Create `package.json` in your MoneyIndex folder:

```json
{
  "name": "moneyindex-production",
  "version": "1.0.0",
  "description": "MoneyIndex Options Analysis Platform",
  "scripts": {
    "dev": "netlify dev",
    "build": "echo 'No build step required'",
    "local": "python run.py"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "razorpay": "^2.9.2",
    "resend": "^2.0.0",
    "crypto-js": "^4.2.0"
  },
  "devDependencies": {
    "netlify-cli": "^17.0.0"
  }
}
```

### 2.2 Netlify Configuration

Create `netlify.toml`:

```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"

# API routes → Serverless functions
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

# Serve existing static files for dashboard
[[redirects]]
  from = "/static/*"
  to = "/static/:splat"
  status = 200

# SPA fallback
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# Security headers
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com; frame-src https://api.razorpay.com;"
    Permissions-Policy = "geolocation=(), microphone=(), camera=()"

# Cache static assets
[[headers]]
  for = "/static/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

# Scheduled function for daily token delivery
[functions]
  [functions."cron-daily-token"]
    schedule = "30 3 * * *"  # 3:30 AM UTC = 9:00 AM IST (before market opens)
```

### 2.3 Environment Variables Template

Create `.env.example`:

```env
# ============================================
# SUPABASE (get from Supabase dashboard)
# ============================================
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJxxxx...
SUPABASE_SERVICE_KEY=eyJxxxx...

# ============================================
# RAZORPAY (get from Razorpay dashboard)
# Test keys for development, Live keys for production
# ============================================
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=xxxx

# ============================================
# TELEGRAM BOT
# Create bot via @BotFather, get token
# ============================================
TELEGRAM_BOT_TOKEN=123456:ABC-xxxx
TELEGRAM_ADMIN_CHAT_ID=123456789

# ============================================
# EMAIL (Resend.com - 3000 free/month)
# ============================================
RESEND_API_KEY=re_xxxx
FROM_EMAIL=noreply@yourdomain.com
ADMIN_EMAIL=hello@bullance.in

# ============================================
# ENCRYPTION (generate: openssl rand -hex 32)
# ============================================
ENCRYPTION_KEY=your-32-byte-hex-key-here

# ============================================
# UPSTOX (for OAuth flow)
# ============================================
UPSTOX_CLIENT_ID=xxxx
UPSTOX_CLIENT_SECRET=xxxx
UPSTOX_REDIRECT_URI=https://yourapp.netlify.app/api/upstox-callback
```

---

## Phase 3: Serverless Functions (Backend)

### 3.1 Folder Structure

```
netlify/
└── functions/
    ├── _shared/                    # Shared utilities
    │   ├── supabase.js
    │   ├── auth.js
    │   ├── validation.js
    │   ├── encryption.js
    │   └── response.js
    │
    ├── auth-register.js            # User registration
    ├── auth-login.js               # User login
    ├── auth-logout.js              # User logout
    │
    ├── payment-create-order.js     # Create Razorpay order
    ├── payment-verify.js           # Verify payment signature
    ├── payment-webhook.js          # Razorpay webhook handler
    │
    ├── market-dashboard.js         # Dashboard data (proxied)
    ├── market-strikes.js           # Strike OI data (proxied)
    ├── market-timeseries.js        # Timeseries data (proxied)
    ├── market-pcr.js               # PCR data (proxied)
    │
    ├── profile-get.js              # Get user profile
    ├── profile-update.js           # Update user profile
    │
    ├── admin-stats.js              # Admin statistics
    ├── admin-users.js              # Admin user management
    │
    ├── contact-send.js             # Contact form handler
    │
    ├── telegram-link.js            # Link Telegram account
    └── cron-daily-token.js         # Scheduled token delivery
```

### 3.2 Shared Utilities

**netlify/functions/_shared/supabase.js**
```javascript
const { createClient } = require('@supabase/supabase-js');

// Client for frontend (uses anon key, respects RLS)
function getSupabaseClient(accessToken = null) {
    const options = accessToken ? {
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
    } : {};

    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        options
    );
}

// Admin client (bypasses RLS - use carefully!)
function getSupabaseAdmin() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );
}

module.exports = { getSupabaseClient, getSupabaseAdmin };
```

**netlify/functions/_shared/auth.js**
```javascript
const { getSupabaseAdmin } = require('./supabase');

async function verifyAuth(event) {
    const authHeader = event.headers.authorization || event.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { user: null, error: 'No authorization header' };
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseAdmin();

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return { user: null, error: 'Invalid token' };
    }

    return { user, error: null };
}

async function verifySubscription(event) {
    const { user, error } = await verifyAuth(event);

    if (error) return { user: null, profile: null, error };

    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!profile) {
        return { user, profile: null, error: 'Profile not found' };
    }

    if (profile.subscription_status !== 'active') {
        return { user, profile, error: 'Subscription inactive' };
    }

    if (new Date(profile.subscription_end) < new Date()) {
        return { user, profile, error: 'Subscription expired' };
    }

    return { user, profile, error: null };
}

async function verifyAdmin(event) {
    const { user, profile, error } = await verifySubscription(event);

    if (error) return { user, profile, error };

    if (!profile.is_admin) {
        return { user, profile, error: 'Admin access required' };
    }

    return { user, profile, error: null };
}

module.exports = { verifyAuth, verifySubscription, verifyAdmin };
```

**netlify/functions/_shared/encryption.js**
```javascript
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

module.exports = { encrypt, decrypt };
```

**netlify/functions/_shared/response.js**
```javascript
const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function success(data, statusCode = 200) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(data)
    };
}

function error(message, statusCode = 400) {
    return {
        statusCode,
        headers,
        body: JSON.stringify({ error: message })
    };
}

function unauthorized(message = 'Unauthorized') {
    return error(message, 401);
}

function forbidden(message = 'Forbidden') {
    return error(message, 403);
}

function handleCORS(event) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }
    return null;
}

module.exports = { success, error, unauthorized, forbidden, handleCORS, headers };
```

### 3.3 Authentication Functions

**netlify/functions/auth-register.js**
```javascript
const { getSupabaseAdmin } = require('./_shared/supabase');
const { success, error, handleCORS } = require('./_shared/response');

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    if (event.httpMethod !== 'POST') {
        return error('Method not allowed', 405);
    }

    try {
        const { email, password, full_name, phone } = JSON.parse(event.body);

        // Validation
        if (!email || !password) {
            return error('Email and password required');
        }

        if (password.length < 8) {
            return error('Password must be at least 8 characters');
        }

        const supabase = getSupabaseAdmin();

        // Create user
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true // Auto-confirm for now
        });

        if (authError) {
            return error(authError.message);
        }

        // Update profile with additional info
        if (full_name || phone) {
            await supabase
                .from('profiles')
                .update({ full_name, phone })
                .eq('id', authData.user.id);
        }

        return success({
            message: 'Registration successful',
            user: { id: authData.user.id, email: authData.user.email }
        });

    } catch (err) {
        console.error('Registration error:', err);
        return error('Registration failed', 500);
    }
};
```

**netlify/functions/auth-login.js**
```javascript
const { getSupabaseAdmin } = require('./_shared/supabase');
const { success, error, handleCORS } = require('./_shared/response');

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    if (event.httpMethod !== 'POST') {
        return error('Method not allowed', 405);
    }

    try {
        const { email, password } = JSON.parse(event.body);

        if (!email || !password) {
            return error('Email and password required');
        }

        const supabase = getSupabaseAdmin();

        // Sign in
        const { data, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError) {
            return error('Invalid credentials', 401);
        }

        // Get profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: data.user.id,
            action: 'login',
            ip_address: event.headers['x-forwarded-for'] || 'unknown'
        });

        return success({
            user: {
                id: data.user.id,
                email: data.user.email,
                full_name: profile?.full_name
            },
            profile: {
                subscription_status: profile?.subscription_status,
                subscription_end: profile?.subscription_end,
                is_admin: profile?.is_admin
            },
            session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        return error('Login failed', 500);
    }
};
```

### 3.4 Payment Functions

**netlify/functions/payment-create-order.js**
```javascript
const Razorpay = require('razorpay');
const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { success, error, unauthorized, handleCORS } = require('./_shared/response');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    if (event.httpMethod !== 'POST') {
        return error('Method not allowed', 405);
    }

    try {
        // Verify user is logged in
        const { user, error: authError } = await verifyAuth(event);
        if (authError) return unauthorized(authError);

        const supabase = getSupabaseAdmin();

        // Get user profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', user.id)
            .single();

        // Create Razorpay order
        const order = await razorpay.orders.create({
            amount: 49900, // ₹499 in paise
            currency: 'INR',
            receipt: `order_${user.id}_${Date.now()}`,
            notes: {
                user_id: user.id,
                email: profile.email,
                product: 'MoneyIndex Premium - 30 Days'
            }
        });

        // Store order in database
        await supabase.from('payments').insert({
            user_id: user.id,
            razorpay_order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            status: 'created'
        });

        return success({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: process.env.RAZORPAY_KEY_ID,
            prefill: {
                name: profile.full_name || '',
                email: profile.email
            }
        });

    } catch (err) {
        console.error('Payment order error:', err);
        return error('Failed to create order', 500);
    }
};
```

**netlify/functions/payment-verify.js**
```javascript
const crypto = require('crypto');
const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { success, error, unauthorized, handleCORS } = require('./_shared/response');

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    if (event.httpMethod !== 'POST') {
        return error('Method not allowed', 405);
    }

    try {
        const { user, error: authError } = await verifyAuth(event);
        if (authError) return unauthorized(authError);

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = JSON.parse(event.body);

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return error('Invalid payment signature', 400);
        }

        const supabase = getSupabaseAdmin();

        // Update payment record
        await supabase
            .from('payments')
            .update({
                razorpay_payment_id,
                razorpay_signature,
                status: 'paid'
            })
            .eq('razorpay_order_id', razorpay_order_id)
            .eq('user_id', user.id);

        // Activate subscription (30 days)
        const now = new Date();
        const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        await supabase
            .from('profiles')
            .update({
                subscription_status: 'active',
                subscription_start: now.toISOString(),
                subscription_end: endDate.toISOString()
            })
            .eq('id', user.id);

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: user.id,
            action: 'payment_success',
            metadata: { amount: 499, order_id: razorpay_order_id }
        });

        return success({
            success: true,
            message: 'Payment verified, subscription activated',
            subscription_end: endDate.toISOString()
        });

    } catch (err) {
        console.error('Payment verification error:', err);
        return error('Verification failed', 500);
    }
};
```

### 3.5 Market Data Proxy (Hides Upstox API)

**netlify/functions/market-dashboard.js**
```javascript
const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifySubscription } = require('./_shared/auth');
const { decrypt } = require('./_shared/encryption');
const { success, error, unauthorized, forbidden, handleCORS } = require('./_shared/response');

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    try {
        // Verify user has active subscription
        const { user, profile, error: authError } = await verifySubscription(event);
        if (authError) {
            if (authError.includes('Subscription')) {
                return forbidden(authError);
            }
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();

        // Get active Upstox token (decrypted)
        const { data: tokens } = await supabase
            .from('access_tokens')
            .select('token_encrypted')
            .eq('is_active', true)
            .limit(1);

        if (!tokens || tokens.length === 0) {
            return error('Market data temporarily unavailable', 503);
        }

        const upstoxToken = decrypt(tokens[0].token_encrypted);

        // Fetch from Upstox API (server-side - client never sees this)
        const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'];
        const dashboardData = {};

        for (const index of indices) {
            // Get latest data from your database or Upstox
            const { data: spotData } = await supabase
                .from('index_spot_history')
                .select('spot_price, time')
                .eq('index_name', index)
                .eq('date', new Date().toISOString().split('T')[0])
                .order('time', { ascending: false })
                .limit(1);

            const { data: pcrData } = await supabase
                .from('pcr_history')
                .select('pcr')
                .eq('index_name', index)
                .eq('date', new Date().toISOString().split('T')[0])
                .order('time', { ascending: false })
                .limit(1);

            dashboardData[index] = {
                spot_price: spotData?.[0]?.spot_price || 0,
                last_update: spotData?.[0]?.time || null,
                pcr: pcrData?.[0]?.pcr || 0
            };
        }

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: user.id,
            action: 'view_dashboard'
        });

        return success(dashboardData);

    } catch (err) {
        console.error('Dashboard error:', err);
        return error('Failed to fetch dashboard data', 500);
    }
};
```

### 3.6 Contact Form

**netlify/functions/contact-send.js**
```javascript
const { Resend } = require('resend');
const { getSupabaseAdmin } = require('./_shared/supabase');
const { success, error, handleCORS } = require('./_shared/response');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    if (event.httpMethod !== 'POST') {
        return error('Method not allowed', 405);
    }

    try {
        const { name, email, subject, message } = JSON.parse(event.body);

        // Validation
        if (!name || name.length < 2) {
            return error('Name is required (min 2 characters)');
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return error('Valid email is required');
        }
        if (!message || message.length < 10) {
            return error('Message is required (min 10 characters)');
        }

        const supabase = getSupabaseAdmin();

        // Store in database
        await supabase.from('contact_messages').insert({
            name,
            email,
            subject: subject || 'No Subject',
            message
        });

        // Send email to admin
        await resend.emails.send({
            from: process.env.FROM_EMAIL || 'MoneyIndex <noreply@moneyindex.app>',
            to: [process.env.ADMIN_EMAIL || 'hello@bullance.in'],
            subject: `Contact Form: ${subject || 'New Message from ' + name}`,
            html: `
                <h2>New Contact Form Submission</h2>
                <p><strong>From:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Subject:</strong> ${subject || 'N/A'}</p>
                <hr>
                <p><strong>Message:</strong></p>
                <p>${message.replace(/\n/g, '<br>')}</p>
                <hr>
                <p><small>Sent from MoneyIndex Contact Form</small></p>
            `
        });

        // Send confirmation to user
        await resend.emails.send({
            from: process.env.FROM_EMAIL || 'MoneyIndex <noreply@moneyindex.app>',
            to: [email],
            subject: 'We received your message - MoneyIndex',
            html: `
                <h2>Thank you for contacting us!</h2>
                <p>Hi ${name},</p>
                <p>We've received your message and will get back to you within 24 hours.</p>
                <br>
                <p>Best regards,</p>
                <p>The MoneyIndex Team</p>
            `
        });

        return success({ message: 'Message sent successfully' });

    } catch (err) {
        console.error('Contact error:', err);
        return error('Failed to send message', 500);
    }
};
```

### 3.7 Daily Token Telegram Bot

**netlify/functions/cron-daily-token.js**
```javascript
const { getSupabaseAdmin } = require('./_shared/supabase');
const { decrypt } = require('./_shared/encryption');

async function sendTelegramMessage(chatId, message) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        })
    });

    return response.ok;
}

exports.handler = async (event) => {
    console.log('Daily token delivery started');

    try {
        const supabase = getSupabaseAdmin();

        // Get active token
        const { data: tokens } = await supabase
            .from('access_tokens')
            .select('token_encrypted, token_name')
            .eq('is_active', true)
            .limit(1);

        if (!tokens || tokens.length === 0) {
            // Alert admin
            await sendTelegramMessage(
                process.env.TELEGRAM_ADMIN_CHAT_ID,
                '⚠️ <b>ALERT:</b> No active Upstox token found!\n\nPlease update the access token immediately.'
            );
            return { statusCode: 200, body: 'No token available' };
        }

        const token = decrypt(tokens[0].token_encrypted);

        // Get all active subscribers with Telegram linked
        const { data: subscribers } = await supabase
            .from('profiles')
            .select('telegram_chat_id, full_name, email')
            .eq('subscription_status', 'active')
            .not('telegram_chat_id', 'is', null)
            .gt('subscription_end', new Date().toISOString());

        if (!subscribers || subscribers.length === 0) {
            await sendTelegramMessage(
                process.env.TELEGRAM_ADMIN_CHAT_ID,
                '📊 Daily token delivery: No active subscribers with Telegram linked.'
            );
            return { statusCode: 200, body: 'No subscribers' };
        }

        // Send token to each subscriber
        const message = `
🔑 <b>Daily Upstox Access Token</b>

<code>${token}</code>

⏰ Valid for today's trading session
📊 Market Hours: 9:15 AM - 3:30 PM IST

<i>Copy the token above and paste in your app settings.</i>

— MoneyIndex Team
        `.trim();

        let successCount = 0;
        let failCount = 0;

        for (const subscriber of subscribers) {
            try {
                const sent = await sendTelegramMessage(subscriber.telegram_chat_id, message);
                if (sent) successCount++;
                else failCount++;
            } catch (err) {
                console.error(`Failed to send to ${subscriber.email}:`, err);
                failCount++;
            }
        }

        // Notify admin
        await sendTelegramMessage(
            process.env.TELEGRAM_ADMIN_CHAT_ID,
            `✅ <b>Daily Token Delivery Complete</b>\n\n` +
            `📤 Sent: ${successCount}\n` +
            `❌ Failed: ${failCount}\n` +
            `📅 Date: ${new Date().toLocaleDateString('en-IN')}`
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ sent: successCount, failed: failCount })
        };

    } catch (err) {
        console.error('Cron error:', err);

        // Alert admin on failure
        await sendTelegramMessage(
            process.env.TELEGRAM_ADMIN_CHAT_ID,
            `❌ <b>Token Delivery FAILED</b>\n\nError: ${err.message}`
        );

        return { statusCode: 500, body: 'Failed' };
    }
};
```

### 3.8 Admin Functions

**netlify/functions/admin-stats.js**
```javascript
const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAdmin } = require('./_shared/auth');
const { success, error, unauthorized, forbidden, handleCORS } = require('./_shared/response');

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    try {
        const { error: authError } = await verifyAdmin(event);
        if (authError) {
            if (authError === 'Admin access required') return forbidden(authError);
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();
        const today = new Date().toISOString().split('T')[0];

        // Get all stats in parallel
        const [
            totalUsersResult,
            activeSubsResult,
            paymentsResult,
            todayLoginsResult,
            recentUsersResult,
            messagesResult
        ] = await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }),
            supabase.from('profiles').select('*', { count: 'exact', head: true })
                .eq('subscription_status', 'active'),
            supabase.from('payments').select('amount').eq('status', 'paid'),
            supabase.from('user_activity').select('*', { count: 'exact', head: true })
                .eq('action', 'login')
                .gte('created_at', today),
            supabase.from('profiles').select('id, email, created_at')
                .order('created_at', { ascending: false })
                .limit(5),
            supabase.from('contact_messages').select('*', { count: 'exact', head: true })
                .eq('status', 'new')
        ]);

        const totalRevenue = (paymentsResult.data || [])
            .reduce((sum, p) => sum + (p.amount || 0), 0) / 100;

        return success({
            total_users: totalUsersResult.count || 0,
            active_subscriptions: activeSubsResult.count || 0,
            total_revenue: totalRevenue,
            today_logins: todayLoginsResult.count || 0,
            unread_messages: messagesResult.count || 0,
            recent_users: recentUsersResult.data || []
        });

    } catch (err) {
        console.error('Admin stats error:', err);
        return error('Failed to fetch stats', 500);
    }
};
```

**netlify/functions/admin-users.js**
```javascript
const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAdmin } = require('./_shared/auth');
const { success, error, unauthorized, forbidden, handleCORS } = require('./_shared/response');

exports.handler = async (event) => {
    const cors = handleCORS(event);
    if (cors) return cors;

    try {
        const { error: authError } = await verifyAdmin(event);
        if (authError) {
            if (authError === 'Admin access required') return forbidden(authError);
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();

        // Parse query parameters
        const params = event.queryStringParameters || {};
        const page = parseInt(params.page) || 1;
        const limit = parseInt(params.limit) || 20;
        const offset = (page - 1) * limit;

        // Get users with pagination
        const { data: users, count } = await supabase
            .from('profiles')
            .select('id, email, full_name, phone, subscription_status, subscription_end, is_admin, created_at', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        return success({
            users: users || [],
            total: count || 0,
            page,
            pages: Math.ceil((count || 0) / limit)
        });

    } catch (err) {
        console.error('Admin users error:', err);
        return error('Failed to fetch users', 500);
    }
};
```

---

## Phase 4: Frontend (Production)

### 4.1 Folder Structure

```
public/
├── index.html              # Landing page
├── login.html              # Login page
├── register.html           # Registration page
├── pricing.html            # Pricing & payment
├── dashboard.html          # Main dashboard (protected)
├── profile.html            # User profile (protected)
├── contact.html            # Contact form
├── admin.html              # Admin panel (admin only)
│
├── js/
│   ├── config.js           # Configuration
│   ├── supabase-client.js  # Supabase initialization
│   ├── auth.js             # Authentication manager
│   ├── api.js              # API client
│   ├── payment.js          # Razorpay integration
│   ├── app.js              # Dashboard app (reuse existing)
│   ├── charts.js           # Charts (reuse existing)
│   └── admin.js            # Admin panel
│
├── css/
│   └── styles.css          # Styles (reuse existing + new pages)
│
└── static/                 # Symlink or copy of existing static folder
    ├── app.js              # Your existing frontend
    ├── charts.js           # Your existing charts
    └── styles.css          # Your existing styles
```

### 4.2 Configuration

**public/js/config.js**
```javascript
// Production configuration
const CONFIG = {
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'eyJxxxx...',
    RAZORPAY_KEY_ID: 'rzp_live_xxxx', // Use test key for development
    PRODUCT_PRICE: 499,
    PRODUCT_NAME: 'MoneyIndex Premium - 30 Days'
};

// Don't modify below
if (typeof module !== 'undefined') {
    module.exports = CONFIG;
}
```

### 4.3 Authentication Manager

**public/js/auth.js**
```javascript
class AuthManager {
    constructor() {
        this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        this.session = null;
        this.profile = null;
    }

    async init() {
        // Check for existing session
        const { data: { session } } = await this.supabase.auth.getSession();
        this.session = session;

        if (session) {
            await this.loadProfile();
        }

        // Listen for auth changes
        this.supabase.auth.onAuthStateChange(async (event, session) => {
            this.session = session;

            if (event === 'SIGNED_IN') {
                await this.loadProfile();
            } else if (event === 'SIGNED_OUT') {
                this.profile = null;
                window.location.href = '/login.html';
            }
        });

        return this.session;
    }

    async loadProfile() {
        if (!this.session) return null;

        const { data } = await this.supabase
            .from('profiles')
            .select('*')
            .eq('id', this.session.user.id)
            .single();

        this.profile = data;
        return data;
    }

    async login(email, password) {
        const response = await fetch('/api/auth-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        // Set session
        await this.supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
        });

        this.profile = data.profile;
        return data;
    }

    async register(email, password, fullName, phone) {
        const response = await fetch('/api/auth-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: fullName, phone })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
        }

        return data;
    }

    async logout() {
        await this.supabase.auth.signOut();
        this.session = null;
        this.profile = null;
        window.location.href = '/login.html';
    }

    isLoggedIn() {
        return !!this.session;
    }

    isSubscribed() {
        if (!this.profile) return false;
        if (this.profile.subscription_status !== 'active') return false;
        if (new Date(this.profile.subscription_end) < new Date()) return false;
        return true;
    }

    isAdmin() {
        return this.profile?.is_admin === true;
    }

    getAuthHeader() {
        if (!this.session?.access_token) return {};
        return { 'Authorization': `Bearer ${this.session.access_token}` };
    }

    // Route protection
    async requireAuth() {
        await this.init();
        if (!this.isLoggedIn()) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    }

    async requireSubscription() {
        const authed = await this.requireAuth();
        if (!authed) return false;

        if (!this.isSubscribed()) {
            window.location.href = '/pricing.html';
            return false;
        }
        return true;
    }

    async requireAdmin() {
        const subscribed = await this.requireSubscription();
        if (!subscribed) return false;

        if (!this.isAdmin()) {
            window.location.href = '/dashboard.html';
            return false;
        }
        return true;
    }
}

const auth = new AuthManager();
```

### 4.4 Payment Integration

**public/js/payment.js**
```javascript
class PaymentManager {
    constructor(authManager) {
        this.auth = authManager;
    }

    async initPayment() {
        try {
            // Create order
            const response = await fetch('/api/payment-create-order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.auth.getAuthHeader()
                }
            });

            const orderData = await response.json();

            if (!response.ok) {
                throw new Error(orderData.error || 'Failed to create order');
            }

            // Open Razorpay checkout
            return this.openCheckout(orderData);

        } catch (err) {
            console.error('Payment init error:', err);
            throw err;
        }
    }

    openCheckout(orderData) {
        return new Promise((resolve, reject) => {
            const options = {
                key: orderData.key_id,
                amount: orderData.amount,
                currency: orderData.currency,
                name: 'MoneyIndex',
                description: CONFIG.PRODUCT_NAME,
                order_id: orderData.order_id,
                prefill: orderData.prefill || {},
                theme: {
                    color: '#6366f1'
                },
                handler: async (response) => {
                    try {
                        // Verify payment
                        const verifyResponse = await fetch('/api/payment-verify', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...this.auth.getAuthHeader()
                            },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature
                            })
                        });

                        const verifyData = await verifyResponse.json();

                        if (!verifyResponse.ok) {
                            throw new Error(verifyData.error || 'Verification failed');
                        }

                        // Reload profile to get updated subscription
                        await this.auth.loadProfile();
                        resolve(verifyData);

                    } catch (err) {
                        reject(err);
                    }
                },
                modal: {
                    ondismiss: () => {
                        reject(new Error('Payment cancelled'));
                    }
                }
            };

            const rzp = new Razorpay(options);
            rzp.open();
        });
    }
}
```

### 4.5 Landing Page

**public/index.html**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MoneyIndex - Real-time Options Analysis</title>
    <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
    <nav class="navbar">
        <div class="logo">MoneyIndex</div>
        <div class="nav-links">
            <a href="/pricing.html">Pricing</a>
            <a href="/contact.html">Contact</a>
            <a href="/login.html" class="btn btn-outline">Login</a>
            <a href="/register.html" class="btn btn-primary">Get Started</a>
        </div>
    </nav>

    <header class="hero">
        <h1>Real-time Options Market Analysis</h1>
        <p>Track OI, PCR, IV, Max Pain and more for NIFTY, BANKNIFTY, FINNIFTY & SENSEX</p>
        <a href="/register.html" class="btn btn-primary btn-large">Start Free Trial</a>
    </header>

    <section class="features">
        <div class="feature">
            <h3>Live Strike Analysis</h3>
            <p>Real-time OI changes across all strikes with butterfly charts</p>
        </div>
        <div class="feature">
            <h3>PCR Tracking</h3>
            <p>Put-Call Ratio with historical trends and alerts</p>
        </div>
        <div class="feature">
            <h3>IV Momentum</h3>
            <p>Implied Volatility patterns and surge detection</p>
        </div>
        <div class="feature">
            <h3>Support & Resistance</h3>
            <p>OI-based S/R levels and Max Pain calculation</p>
        </div>
    </section>

    <section class="pricing-preview">
        <h2>Simple Pricing</h2>
        <div class="price-card">
            <h3>Premium</h3>
            <div class="price">₹499<span>/month</span></div>
            <ul>
                <li>All 6 indices covered</li>
                <li>Real-time data updates</li>
                <li>Daily Telegram token delivery</li>
                <li>Priority support</li>
            </ul>
            <a href="/pricing.html" class="btn btn-primary">Subscribe Now</a>
        </div>
    </section>

    <footer>
        <p>&copy; 2024 MoneyIndex. All rights reserved.</p>
        <p>Contact: <a href="mailto:hello@bullance.in">hello@bullance.in</a></p>
    </footer>
</body>
</html>
```

### 4.6 Login Page

**public/login.html**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - MoneyIndex</title>
    <link rel="stylesheet" href="/css/styles.css">
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
    <div class="auth-container">
        <div class="auth-card">
            <h1>Welcome Back</h1>
            <p>Login to access your dashboard</p>

            <form id="login-form">
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" required>
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" required minlength="8">
                </div>
                <button type="submit" class="btn btn-primary btn-block">Login</button>
            </form>

            <div id="error-message" class="error-message" style="display: none;"></div>

            <p class="auth-link">
                Don't have an account? <a href="/register.html">Register</a>
            </p>
        </div>
    </div>

    <script src="/js/config.js"></script>
    <script src="/js/auth.js"></script>
    <script>
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error-message');

            try {
                errorDiv.style.display = 'none';
                await auth.login(email, password);

                // Redirect based on subscription status
                if (auth.isSubscribed()) {
                    window.location.href = '/dashboard.html';
                } else {
                    window.location.href = '/pricing.html';
                }
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.style.display = 'block';
            }
        });

        // Check if already logged in
        auth.init().then(() => {
            if (auth.isLoggedIn()) {
                window.location.href = auth.isSubscribed() ? '/dashboard.html' : '/pricing.html';
            }
        });
    </script>
</body>
</html>
```

### 4.7 Dashboard Page (Protected)

**public/dashboard.html**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - MoneyIndex</title>
    <link rel="stylesheet" href="/static/styles.css">
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
    <nav class="navbar">
        <div class="logo">MoneyIndex</div>
        <div class="nav-links">
            <a href="/profile.html">Profile</a>
            <span id="user-email"></span>
            <button onclick="auth.logout()" class="btn btn-outline">Logout</button>
        </div>
    </nav>

    <div id="loading" class="loading">Loading...</div>
    <div id="app" style="display: none;">
        <!-- Your existing dashboard content will be loaded here -->
        <!-- Or include your existing static/index.html content -->
    </div>

    <script src="/js/config.js"></script>
    <script src="/js/auth.js"></script>
    <script src="/js/api.js"></script>
    <script src="/static/charts.js"></script>
    <script src="/static/app.js"></script>
    <script>
        // Protect this page
        (async () => {
            const allowed = await auth.requireSubscription();
            if (!allowed) return;

            // Show user info
            document.getElementById('user-email').textContent = auth.profile?.email || '';

            // Hide loading, show app
            document.getElementById('loading').style.display = 'none';
            document.getElementById('app').style.display = 'block';

            // Initialize your existing app
            // The app will use /api/market-* endpoints instead of direct Upstox calls
            initApp();
        })();
    </script>
</body>
</html>
```

### 4.8 Profile Page

**public/profile.html**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Profile - MoneyIndex</title>
    <link rel="stylesheet" href="/css/styles.css">
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
    <nav class="navbar">
        <div class="logo">MoneyIndex</div>
        <div class="nav-links">
            <a href="/dashboard.html">Dashboard</a>
            <button onclick="auth.logout()" class="btn btn-outline">Logout</button>
        </div>
    </nav>

    <div class="container">
        <h1>Your Profile</h1>

        <section class="card">
            <h2>Account Information</h2>
            <form id="profile-form">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="email" disabled>
                </div>
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="full_name">
                </div>
                <div class="form-group">
                    <label>Phone</label>
                    <input type="tel" id="phone" pattern="[0-9]{10}">
                </div>
                <div class="form-group">
                    <label>Telegram Chat ID</label>
                    <input type="text" id="telegram_chat_id">
                    <small>Message <a href="https://t.me/userinfobot" target="_blank">@userinfobot</a> on Telegram to get your Chat ID</small>
                </div>
                <button type="submit" class="btn btn-primary">Save Changes</button>
            </form>
            <div id="message" class="message" style="display: none;"></div>
        </section>

        <section class="card">
            <h2>Subscription</h2>
            <div id="subscription-info">
                <p><strong>Status:</strong> <span id="sub-status"></span></p>
                <p><strong>Valid Until:</strong> <span id="sub-end"></span></p>
            </div>
            <div id="renew-section" style="display: none;">
                <p>Your subscription has expired or is inactive.</p>
                <a href="/pricing.html" class="btn btn-primary">Renew Subscription</a>
            </div>
        </section>

        <section class="card">
            <h2>Security</h2>
            <button id="change-password" class="btn btn-outline">Change Password</button>
        </section>
    </div>

    <script src="/js/config.js"></script>
    <script src="/js/auth.js"></script>
    <script>
        (async () => {
            const allowed = await auth.requireAuth();
            if (!allowed) return;

            // Populate form
            const profile = auth.profile;
            document.getElementById('email').value = profile?.email || '';
            document.getElementById('full_name').value = profile?.full_name || '';
            document.getElementById('phone').value = profile?.phone || '';
            document.getElementById('telegram_chat_id').value = profile?.telegram_chat_id || '';

            // Subscription info
            const status = profile?.subscription_status || 'inactive';
            const endDate = profile?.subscription_end ? new Date(profile.subscription_end) : null;

            document.getElementById('sub-status').textContent = status.toUpperCase();
            document.getElementById('sub-status').className = `status-${status}`;
            document.getElementById('sub-end').textContent = endDate ? endDate.toLocaleDateString() : 'N/A';

            if (status !== 'active' || (endDate && endDate < new Date())) {
                document.getElementById('renew-section').style.display = 'block';
            }

            // Form submission
            document.getElementById('profile-form').addEventListener('submit', async (e) => {
                e.preventDefault();

                const updates = {
                    full_name: document.getElementById('full_name').value,
                    phone: document.getElementById('phone').value,
                    telegram_chat_id: document.getElementById('telegram_chat_id').value
                };

                const { error } = await auth.supabase
                    .from('profiles')
                    .update(updates)
                    .eq('id', auth.session.user.id);

                const msgDiv = document.getElementById('message');
                if (error) {
                    msgDiv.textContent = 'Failed to update profile';
                    msgDiv.className = 'message error';
                } else {
                    msgDiv.textContent = 'Profile updated successfully';
                    msgDiv.className = 'message success';
                }
                msgDiv.style.display = 'block';
            });
        })();
    </script>
</body>
</html>
```

---

## Phase 5: Security Checklist

### 5.1 What's Protected

| Threat | Protection |
|--------|------------|
| **API Token Exposure** | Token encrypted in DB, decrypted only server-side |
| **Upstox API Hidden** | All calls proxied through Netlify Functions |
| **SQL Injection** | Supabase parameterized queries + RLS |
| **XSS** | CSP headers, input sanitization |
| **CSRF** | SameSite cookies, token verification |
| **Brute Force** | Rate limiting on auth endpoints |
| **Data Leakage** | Row Level Security per user |
| **Session Hijacking** | Short-lived JWTs, secure cookies |
| **Unauthorized Access** | Auth verification on every API call |

### 5.2 What Visitors See

When someone inspects Network tab:
```
❌ No Upstox API calls visible
❌ No access tokens visible
❌ No database queries visible

✅ Only see: /api/market-dashboard (your Netlify function)
✅ Only see: Supabase auth calls (standard, secure)
```

### 5.3 Rate Limiting (Add to functions)

```javascript
// Simple in-memory rate limiting (for production, use Redis)
const rateLimits = new Map();

function checkRateLimit(ip, limit = 100, windowMs = 60000) {
    const now = Date.now();
    const key = `${ip}`;

    if (!rateLimits.has(key)) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }

    const data = rateLimits.get(key);

    if (now > data.resetAt) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }

    if (data.count >= limit) {
        return false;
    }

    data.count++;
    return true;
}

// Use in functions:
if (!checkRateLimit(event.headers['x-forwarded-for'], 100)) {
    return { statusCode: 429, body: 'Too many requests' };
}
```

---

## Phase 6: Telegram Bot Setup

### 6.1 Create Bot

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Follow prompts to name your bot
4. Save the token: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`

### 6.2 Get Admin Chat ID

1. Message `@userinfobot` on Telegram
2. It will reply with your Chat ID (e.g., `123456789`)
3. Add this as `TELEGRAM_ADMIN_CHAT_ID` in Netlify env vars

### 6.3 User Links Telegram

Users get their Chat ID the same way and enter it in their profile page.

---

## Phase 7: Deployment Steps

### 7.1 Prerequisites

1. **GitHub Account** - For repository hosting
2. **Netlify Account** - For hosting (free tier)
3. **Supabase Account** - For database (free tier)
4. **Razorpay Account** - For payments (free to setup)
5. **Resend Account** - For emails (free tier: 3000/month)
6. **Telegram Bot** - Created via @BotFather

### 7.2 Step-by-Step Deployment

```bash
# 1. Initialize git (if not already)
cd E:\MoneyIndex
git init
git add .
git commit -m "Initial commit"

# 2. Create GitHub repository
# Go to github.com, create new repo "moneyindex"

# 3. Push to GitHub
git remote add origin https://github.com/yourusername/moneyindex.git
git push -u origin main

# 4. Connect to Netlify
# - Go to netlify.com
# - Click "Add new site" > "Import existing project"
# - Select GitHub > Select your repo
# - Build settings:
#   - Build command: (leave empty or "npm install")
#   - Publish directory: public
#   - Functions directory: netlify/functions

# 5. Add Environment Variables in Netlify
# Go to Site settings > Environment variables
# Add all variables from .env.example

# 6. Deploy
# Netlify auto-deploys on every push to main branch

# 7. Set custom domain (optional)
# Go to Domain settings > Add custom domain
```

### 7.3 Local Development

Your existing local system still works:

```bash
# Run your current local system
python run.py
# Access at http://localhost:8001

# OR test Netlify functions locally
npm install
netlify dev
# Access at http://localhost:8888
```

---

## Phase 8: Implementation Checklist

### Week 1: Foundation
- [ ] Create Supabase project
- [ ] Run database schema SQL
- [ ] Create Netlify account
- [ ] Set up project structure
- [ ] Add environment variables
- [ ] Create shared utility functions
- [ ] Implement auth functions (register, login, logout)

### Week 2: Payment System
- [ ] Create Razorpay account (test mode)
- [ ] Implement payment-create-order function
- [ ] Implement payment-verify function
- [ ] Create pricing page with Razorpay checkout
- [ ] Test complete payment flow

### Week 3: Core Features
- [ ] Implement market data proxy functions
- [ ] Create dashboard page
- [ ] Create profile page
- [ ] Integrate existing charts/frontend
- [ ] Test subscription gating

### Week 4: Messaging & Admin
- [ ] Create Resend account
- [ ] Implement contact form function
- [ ] Create contact page
- [ ] Implement admin stats function
- [ ] Implement admin users function
- [ ] Create admin dashboard

### Week 5: Telegram & Polish
- [ ] Create Telegram bot
- [ ] Implement cron-daily-token function
- [ ] Test token delivery
- [ ] Security audit
- [ ] Performance testing
- [ ] Bug fixes

### Week 6: Launch
- [ ] Switch Razorpay to live mode
- [ ] Final testing
- [ ] Deploy to production
- [ ] Monitor for issues

---

## Cost Summary

| Service | Free Tier | Your Usage | Monthly Cost |
|---------|-----------|------------|--------------|
| Netlify | 100GB bandwidth | ~10GB | ₹0 |
| Supabase | 500MB DB, 50K users | ~100MB, ~1000 users | ₹0 |
| Razorpay | No monthly fee | Per sale | ₹12/sale |
| Resend | 3000 emails/month | ~500 emails | ₹0 |
| Telegram | Unlimited | N/A | ₹0 |
| **Total** | | | **₹0 + ₹12/sale** |

**Revenue per sale:** ₹499 - ₹12 = **₹487 net**

---

## Quick Reference: API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth-register` | POST | None | User registration |
| `/api/auth-login` | POST | None | User login |
| `/api/auth-logout` | POST | Token | User logout |
| `/api/payment-create-order` | POST | Token | Create Razorpay order |
| `/api/payment-verify` | POST | Token | Verify payment |
| `/api/market-dashboard` | GET | Subscription | Dashboard data |
| `/api/market-strikes` | GET | Subscription | Strike OI data |
| `/api/market-timeseries` | GET | Subscription | Timeseries data |
| `/api/profile-get` | GET | Token | Get profile |
| `/api/profile-update` | POST | Token | Update profile |
| `/api/admin-stats` | GET | Admin | Admin statistics |
| `/api/admin-users` | GET | Admin | User list |
| `/api/contact-send` | POST | None | Contact form |

---

## Files Summary

```
NEW FILES TO CREATE:
├── netlify.toml
├── package.json
├── .env.example
├── netlify/functions/
│   ├── _shared/supabase.js
│   ├── _shared/auth.js
│   ├── _shared/encryption.js
│   ├── _shared/response.js
│   ├── auth-register.js
│   ├── auth-login.js
│   ├── payment-create-order.js
│   ├── payment-verify.js
│   ├── market-dashboard.js
│   ├── admin-stats.js
│   ├── admin-users.js
│   ├── contact-send.js
│   └── cron-daily-token.js
├── public/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── pricing.html
│   ├── dashboard.html
│   ├── profile.html
│   ├── contact.html
│   ├── admin.html
│   ├── js/config.js
│   ├── js/auth.js
│   ├── js/payment.js
│   └── css/styles.css

EXISTING FILES (UNCHANGED):
├── server.py          # Your local server
├── config.py          # Your config
├── init_db.py         # SQLite init
├── run.py             # Local startup
├── requirements.txt   # Python deps
└── static/            # Your current frontend
```

---

## Next Steps

1. **Review this plan** - Ask questions if anything is unclear
2. **Create accounts** - Supabase, Razorpay, Resend, Netlify
3. **Start with Phase 1** - Database setup in Supabase
4. **Proceed phase by phase** - Each builds on the previous

Ready to start implementation? Let me know which phase to begin with.
