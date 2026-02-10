/**
 * MoneyIndex Authentication Manager
 * Handles user authentication, sessions, and route protection
 */

class AuthManager {
    constructor() {
        this.supabase = null;
        this.session = null;
        this.profile = null;
        this.initialized = false;
        this.listeners = [];
    }

    /**
     * Initialize the auth manager
     */
    async init() {
        if (this.initialized) return this.session;

        // Initialize Supabase client
        if (typeof supabase !== 'undefined' && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
            this.supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

            // Check for existing session
            const { data: { session } } = await this.supabase.auth.getSession();
            this.session = session;

            if (session) {
                await this.loadProfile();
            }

            // Listen for auth changes
            this.supabase.auth.onAuthStateChange(async (event, session) => {
                console.log('Auth state changed:', event);
                this.session = session;

                if (event === 'SIGNED_IN') {
                    await this.loadProfile();
                    this.notifyListeners('signin', { session, profile: this.profile });
                } else if (event === 'SIGNED_OUT') {
                    this.profile = null;
                    this.notifyListeners('signout', {});
                } else if (event === 'TOKEN_REFRESHED') {
                    this.notifyListeners('refresh', { session });
                }
            });
        }

        this.initialized = true;
        return this.session;
    }

    /**
     * Load user profile from database
     */
    async loadProfile() {
        if (!this.session || !this.supabase) return null;

        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .select('*')
                .eq('id', this.session.user.id)
                .single();

            if (error) throw error;

            this.profile = data;

            // Check subscription expiry
            if (this.profile.subscription_status === 'active' && this.profile.subscription_end) {
                if (new Date(this.profile.subscription_end) < new Date()) {
                    this.profile.subscription_status = 'expired';
                }
            }

            return this.profile;
        } catch (err) {
            console.error('Failed to load profile:', err);
            return null;
        }
    }

    /**
     * Register a new user
     */
    async register(email, password, fullName = null, phone = null) {
        const response = await fetch(`${CONFIG.API_BASE}/api/auth-register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                password,
                full_name: fullName,
                phone
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.details?.join(', ') || 'Registration failed');
        }

        return data;
    }

    /**
     * Login user
     */
    async login(email, password) {
        const response = await fetch(`${CONFIG.API_BASE}/api/auth-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        // Set session in Supabase client
        if (this.supabase && data.session) {
            await this.supabase.auth.setSession({
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token
            });
        }

        this.session = data.session;
        this.profile = data.profile;

        return data;
    }

    /**
     * Logout user
     */
    async logout() {
        try {
            await fetch(`${CONFIG.API_BASE}/api/auth-logout`, {
                method: 'POST',
                headers: this.getAuthHeaders()
            });
        } catch (err) {
            console.error('Logout API error:', err);
        }

        if (this.supabase) {
            await this.supabase.auth.signOut();
        }

        this.session = null;
        this.profile = null;

        // Redirect to login
        window.location.href = '/login.html';
    }

    /**
     * Check if user is logged in
     */
    isLoggedIn() {
        return !!this.session?.access_token;
    }

    /**
     * Check if user has active subscription
     */
    isSubscribed() {
        if (!this.profile) return false;
        if (this.profile.subscription_status !== 'active') return false;
        if (!this.profile.subscription_end) return false;
        return new Date(this.profile.subscription_end) > new Date();
    }

    /**
     * Check if user is admin
     */
    isAdmin() {
        return this.profile?.is_admin === true;
    }

    /**
     * Get authorization headers for API calls
     */
    getAuthHeaders() {
        if (!this.session?.access_token) return {};
        return {
            'Authorization': `Bearer ${this.session.access_token}`
        };
    }

    /**
     * Get user's access token
     */
    getAccessToken() {
        return this.session?.access_token || null;
    }

    /**
     * Require authentication - redirect if not logged in
     */
    async requireAuth() {
        await this.init();

        if (!this.isLoggedIn()) {
            // Store intended destination
            sessionStorage.setItem('auth_redirect', window.location.pathname);
            window.location.href = '/login.html';
            return false;
        }

        return true;
    }

    /**
     * Require active subscription - redirect if not subscribed
     */
    async requireSubscription() {
        const authed = await this.requireAuth();
        if (!authed) return false;

        await this.loadProfile(); // Refresh profile

        if (!this.isSubscribed()) {
            window.location.href = '/pricing.html';
            return false;
        }

        return true;
    }

    /**
     * Require admin access - redirect if not admin
     */
    async requireAdmin() {
        const subscribed = await this.requireSubscription();
        if (!subscribed) return false;

        if (!this.isAdmin()) {
            window.location.href = '/dashboard.html';
            return false;
        }

        return true;
    }

    /**
     * Add auth state change listener
     */
    onAuthStateChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    /**
     * Notify all listeners of auth state change
     */
    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (err) {
                console.error('Auth listener error:', err);
            }
        });
    }

    /**
     * Get subscription status display info
     */
    getSubscriptionInfo() {
        if (!this.profile) {
            return { status: 'Unknown', statusClass: 'unknown', daysLeft: 0 };
        }

        const status = this.profile.subscription_status;
        const endDate = this.profile.subscription_end ? new Date(this.profile.subscription_end) : null;

        if (status === 'active' && endDate && endDate > new Date()) {
            const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
            return {
                status: 'Active',
                statusClass: 'active',
                daysLeft,
                endDate: endDate.toLocaleDateString('en-IN')
            };
        } else if (status === 'expired' || (endDate && endDate < new Date())) {
            return { status: 'Expired', statusClass: 'expired', daysLeft: 0 };
        } else {
            return { status: 'Inactive', statusClass: 'inactive', daysLeft: 0 };
        }
    }
}

// Create global instance
const auth = new AuthManager();

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => auth.init());
} else {
    auth.init();
}
