# MoneyIndex - Setup Guide

Follow these steps to deploy your MoneyIndex application.

---

## Step 1: Create Required Accounts

You'll need accounts on these platforms (all have free tiers):

### 1.1 Supabase (Database + Auth)
1. Go to https://supabase.com
2. Sign up / Login with GitHub
3. Click "New Project"
4. Choose organization, set project name: `moneyindex`
5. Set a strong database password (save it!)
6. Select region: **Singapore** (closest to India)
7. Click "Create new project"
8. Wait 2-3 minutes for project to be ready

**Get your keys:**
- Go to Settings → API
- Copy:
  - `Project URL` (e.g., https://xxxxx.supabase.co)
  - `anon public` key
  - `service_role` key (keep this secret!)

### 1.2 Razorpay (Payments)
1. Go to https://razorpay.com
2. Sign up for a business account
3. Complete KYC verification (may take 1-2 days)
4. Go to Settings → API Keys
5. Generate Test API Keys first (for development)
6. Copy `Key ID` and `Key Secret`

**For ₹499 product:** Razorpay charges ~2% + GST = ~₹12 per transaction

### 1.3 Resend (Email)
1. Go to https://resend.com
2. Sign up (free tier: 3000 emails/month)
3. Go to API Keys
4. Create new API key
5. Copy the key (starts with `re_`)

**Important:** You'll need to verify your domain later for production emails.

### 1.4 Telegram Bot
1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Follow prompts:
   - Name: `MoneyIndex Token Bot`
   - Username: `moneyindex_bot` (must be unique)
4. Copy the bot token (format: `123456:ABC-xxxxx`)

**Get your admin Chat ID:**
1. Search for `@userinfobot` on Telegram
2. Send `/start`
3. Copy your Chat ID (a number like `123456789`)

### 1.5 Netlify (Hosting)
1. Go to https://netlify.com
2. Sign up with GitHub
3. We'll connect your repository later

### 1.6 GitHub (Code Repository)
1. Go to https://github.com
2. Create new repository: `moneyindex`
3. Keep it private (recommended)

---

## Step 2: Configure Supabase Database

### 2.1 Run the Schema
1. Go to your Supabase project
2. Click on "SQL Editor" in the sidebar
3. Click "New query"
4. Copy the entire contents of `supabase-schema.sql` file
5. Paste into the editor
6. Click "Run" (or Ctrl+Enter)
7. You should see "Success" messages

### 2.2 Create Your Admin Account
1. Go to Authentication → Users
2. Click "Add user" → "Create new user"
3. Enter your email and a password
4. Click "Create user"
5. Go back to SQL Editor and run:
```sql
UPDATE profiles SET is_admin = true WHERE email = 'your@email.com';
```
Replace `your@email.com` with your actual email.

### 2.3 Configure Auth Settings
1. Go to Authentication → Providers
2. Ensure "Email" is enabled
3. Optional: Disable "Confirm email" for faster testing
4. Go to Authentication → URL Configuration
5. Set Site URL to your Netlify URL (after deployment)

---

## Step 3: Set Up Local Environment

### 3.1 Install Dependencies
```bash
cd E:\MoneyIndex
npm install
```

### 3.2 Create Environment File
Create a `.env` file in the project root:

```env
# Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Razorpay (use TEST keys for development)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ADMIN_CHAT_ID=123456789

# Resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=MoneyIndex <noreply@yourdomain.com>
ADMIN_EMAIL=hello@bullance.in

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=your-64-character-hex-string-here

# Product
PRODUCT_PRICE_PAISE=49900
PRODUCT_NAME=MoneyIndex Premium - 30 Days
```

### 3.3 Update Frontend Config
Edit `public/js/config.js`:

```javascript
const CONFIG = {
    SUPABASE_URL: 'https://your-project-id.supabase.co',
    SUPABASE_ANON_KEY: 'your-anon-key-here',
    RAZORPAY_KEY_ID: 'rzp_test_xxxxxxxxxxxx',
    // ... rest of config
};
```

---

## Step 4: Generate Encryption Key

Run this command to generate a secure encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output (64 characters) and add it to your `.env` file as `ENCRYPTION_KEY`.

---

## Step 5: Push to GitHub

```bash
cd E:\MoneyIndex
git init
git add .
git commit -m "Initial commit - MoneyIndex deployment setup"
git remote add origin https://github.com/yourusername/moneyindex.git
git push -u origin main
```

---

## Step 6: Deploy to Netlify

### 6.1 Connect Repository
1. Go to Netlify dashboard
2. Click "Add new site" → "Import an existing project"
3. Choose "GitHub"
4. Authorize Netlify to access your repositories
5. Select your `moneyindex` repository

### 6.2 Configure Build Settings
- **Build command:** (leave empty or `npm install`)
- **Publish directory:** `public`
- **Functions directory:** `netlify/functions`

Click "Deploy site"

### 6.3 Add Environment Variables
1. Go to Site settings → Environment variables
2. Add ALL variables from your `.env` file:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ADMIN_CHAT_ID`
   - `RESEND_API_KEY`
   - `FROM_EMAIL`
   - `ADMIN_EMAIL`
   - `ENCRYPTION_KEY`
   - `PRODUCT_PRICE_PAISE`
   - `PRODUCT_NAME`

3. Click "Save"
4. Go to Deploys → Trigger deploy → Deploy site

### 6.4 Get Your Site URL
After deployment, you'll get a URL like:
`https://random-name-12345.netlify.app`

You can add a custom domain later in Domain settings.

---

## Step 7: Configure Supabase Redirect URLs

1. Go to Supabase → Authentication → URL Configuration
2. Set **Site URL** to your Netlify URL
3. Add to **Redirect URLs**:
   - `https://your-site.netlify.app/*`
   - `http://localhost:8888/*` (for local testing)

---

## Step 8: Configure Razorpay Webhook (Optional but Recommended)

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Add new webhook:
   - URL: `https://your-site.netlify.app/api/payment-webhook`
   - Events: Select all payment events
3. Copy webhook secret and add to Netlify env vars as `RAZORPAY_WEBHOOK_SECRET`

---

## Step 9: Add Your First Access Token

### Via Admin Panel:
1. Go to `https://your-site.netlify.app/login.html`
2. Login with your admin account
3. Go to `https://your-site.netlify.app/admin.html`
4. Click on "Access Tokens" tab
5. Click "Add New Token"
6. Paste your Upstox access token
7. Click Save

### Via Supabase (Alternative):
1. Go to Supabase → Table Editor → access_tokens
2. Click "Insert row"
3. Fill in:
   - `token_encrypted`: Your encrypted token (you'll need to encrypt it first)
   - `token_name`: "primary"
   - `is_active`: true

**To encrypt a token manually:**
```javascript
// Run in Node.js
const crypto = require('crypto');

const key = Buffer.from('YOUR_ENCRYPTION_KEY_HERE', 'hex');
const text = 'YOUR_UPSTOX_TOKEN_HERE';

const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(text, 'utf8', 'hex');
encrypted += cipher.final('hex');
const authTag = cipher.getAuthTag().toString('hex');

console.log(`${iv.toString('hex')}:${authTag}:${encrypted}`);
```

---

## Step 10: Test Everything

### 10.1 Test Registration
1. Go to your site's `/register.html`
2. Create a test account
3. Check Supabase → Authentication → Users

### 10.2 Test Login
1. Go to `/login.html`
2. Login with your test account
3. You should be redirected to `/pricing.html` (no subscription yet)

### 10.3 Test Payment (Use Test Mode)
1. Make sure you're using Razorpay TEST keys
2. Click "Subscribe Now"
3. Use test card: `4111 1111 1111 1111`
4. Any future expiry, any CVV
5. Payment should succeed
6. You should be redirected to dashboard

### 10.4 Test Admin Panel
1. Login with your admin account
2. Go to `/admin.html`
3. Check that stats are loading
4. Try adding an access token

### 10.5 Test Telegram (After Adding Token)
1. Message your bot on Telegram
2. Wait for the daily cron (or manually trigger it)
3. You should receive the token

---

## Step 11: Go Live Checklist

Before launching to real users:

- [ ] Switch Razorpay to LIVE keys
- [ ] Verify your domain on Resend
- [ ] Enable email confirmation in Supabase
- [ ] Test payment with real card (₹1 test)
- [ ] Set up custom domain
- [ ] Enable HTTPS (automatic on Netlify)
- [ ] Test all user flows
- [ ] Add privacy policy / terms pages

---

## Troubleshooting

### "Unauthorized" errors
- Check if your Supabase keys are correct
- Check if user has active subscription
- Check browser console for specific errors

### Payment not working
- Ensure Razorpay keys are correct
- Check Razorpay dashboard for error logs
- Test with test card first

### Telegram not sending
- Check bot token is correct
- Check admin chat ID is correct
- Check Netlify function logs

### Database errors
- Check Supabase dashboard for error logs
- Ensure RLS policies are correct
- Check if tables exist

---

## Local Development

To run locally:

```bash
# Run your existing local system
python run.py

# OR run Netlify dev server (for testing functions)
npm run dev
# Access at http://localhost:8888
```

---

## Support

- Email: hello@bullance.in
- Issues: Check Netlify function logs and Supabase logs

---

## Files Reference

```
MoneyIndex/
├── netlify.toml           # Netlify configuration
├── package.json           # Node.js dependencies
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore rules
├── supabase-schema.sql    # Database schema
├── SETUP_GUIDE.md         # This file
├── DEPLOYMENT_PLAN.md     # Detailed architecture plan
│
├── netlify/functions/     # Backend serverless functions
│   ├── _shared/           # Shared utilities
│   ├── auth-*.js          # Authentication
│   ├── payment-*.js       # Payments
│   ├── market-*.js        # Market data
│   ├── admin-*.js         # Admin functions
│   ├── profile-*.js       # Profile management
│   ├── contact-send.js    # Contact form
│   └── cron-daily-token.js # Telegram token delivery
│
├── public/                # Frontend (production)
│   ├── index.html         # Landing page
│   ├── login.html         # Login page
│   ├── register.html      # Registration
│   ├── pricing.html       # Pricing & payment
│   ├── dashboard.html     # Main dashboard
│   ├── profile.html       # User profile
│   ├── contact.html       # Contact form
│   ├── admin.html         # Admin panel
│   ├── js/                # JavaScript files
│   └── css/               # Stylesheets
│
├── static/                # Your existing frontend (local)
├── server.py              # Your existing backend (local)
└── ...                    # Other existing files
```
