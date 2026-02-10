/**
 * MoneyIndex Frontend Configuration
 * These values are replaced during build or set via environment
 */

const CONFIG = {
    // Supabase Configuration (public keys only - safe to expose)
    SUPABASE_URL: 'https://hsdlsosfxnderinmerso.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZGxzb3NmeG5kZXJpbm1lcnNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjA5NjMsImV4cCI6MjA4NjI5Njk2M30.gWQ1IARtWfxRF_TNf_CYPYi3sj7U5AOyfs9CXGWnuig',

    // Payment Gateway (dummy for now - will be replaced with Razorpay later)
    PAYMENT_MODE: 'dummy',

    // Product Details
    PRODUCT_PRICE: 499,
    PRODUCT_PRICE_DISPLAY: '₹499',
    PRODUCT_NAME: 'MoneyIndex Premium - 30 Days',

    // API Base URL (empty for same domain)
    API_BASE: '',

    // App Info
    APP_NAME: 'MoneyIndex',
    SUPPORT_EMAIL: 'hello@bullance.in',

    // Feature Flags
    FEATURES: {
        TELEGRAM_INTEGRATION: true,
        DARK_MODE: true
    }
};

// Freeze config to prevent modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.FEATURES);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
