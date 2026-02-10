/**
 * MoneyIndex API Client
 * Handles all API communication with the backend
 */

class APIClient {
    constructor(authManager) {
        this.auth = authManager;
        this.baseUrl = CONFIG.API_BASE || '';
    }

    /**
     * Make authenticated API request
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        const headers = {
            'Content-Type': 'application/json',
            ...this.auth.getAuthHeaders(),
            ...options.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            // Handle 401 - token expired
            if (response.status === 401) {
                // Try to refresh session
                if (this.auth.supabase) {
                    const { data, error } = await this.auth.supabase.auth.refreshSession();
                    if (!error && data.session) {
                        // Retry request with new token
                        headers.Authorization = `Bearer ${data.session.access_token}`;
                        const retryResponse = await fetch(url, { ...options, headers });
                        return this.handleResponse(retryResponse);
                    }
                }

                // Redirect to login if refresh fails
                this.auth.logout();
                throw new Error('Session expired. Please login again.');
            }

            return this.handleResponse(response);
        } catch (err) {
            console.error(`API error for ${endpoint}:`, err);
            throw err;
        }
    }

    /**
     * Handle API response
     */
    async handleResponse(response) {
        const data = await response.json();

        if (!response.ok) {
            const error = new Error(data.error || data.details?.join(', ') || 'Request failed');
            error.status = response.status;
            error.data = data;
            throw error;
        }

        return data;
    }

    // ==================== Market Data ====================

    /**
     * Get dashboard data
     */
    async getDashboard() {
        return this.request('/api/market-dashboard');
    }

    /**
     * Get strike data for an index
     */
    async getStrikes(indexName, date = null) {
        const params = date ? `?date=${date}` : '';
        return this.request(`/api/market-strikes?index=${indexName}${params}`);
    }

    /**
     * Get timeseries data for an index
     */
    async getTimeseries(indexName, date = null) {
        const params = date ? `?date=${date}` : '';
        return this.request(`/api/market-timeseries?index=${indexName}${params}`);
    }

    /**
     * Get PCR data for an index
     */
    async getPCR(indexName, date = null) {
        const params = date ? `?date=${date}` : '';
        return this.request(`/api/market-pcr?index=${indexName}${params}`);
    }

    // ==================== Profile ====================

    /**
     * Get user profile
     */
    async getProfile() {
        return this.request('/api/profile-get');
    }

    /**
     * Update user profile
     */
    async updateProfile(data) {
        return this.request('/api/profile-update', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // ==================== Payments ====================

    /**
     * Create payment order
     */
    async createPaymentOrder() {
        return this.request('/api/payment-create-order', {
            method: 'POST'
        });
    }

    /**
     * Verify payment
     */
    async verifyPayment(paymentData) {
        return this.request('/api/payment-verify', {
            method: 'POST',
            body: JSON.stringify(paymentData)
        });
    }

    // ==================== Contact ====================

    /**
     * Send contact message
     */
    async sendContactMessage(data) {
        return this.request('/api/contact-send', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // ==================== Admin ====================

    /**
     * Get admin stats
     */
    async getAdminStats() {
        return this.request('/api/admin-stats');
    }

    /**
     * Get admin users list
     */
    async getAdminUsers(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/admin-users?${query}`);
    }

    /**
     * Update user (admin)
     */
    async updateUser(userId, action, data = {}) {
        return this.request('/api/admin-users', {
            method: 'PATCH',
            body: JSON.stringify({ user_id: userId, action, ...data })
        });
    }

    /**
     * Get admin tokens
     */
    async getAdminTokens() {
        return this.request('/api/admin-tokens');
    }

    /**
     * Add new token (admin)
     */
    async addToken(token, tokenName = 'primary', expiresAt = null) {
        return this.request('/api/admin-tokens', {
            method: 'POST',
            body: JSON.stringify({ token, token_name: tokenName, expires_at: expiresAt })
        });
    }

    /**
     * Update token status (admin)
     */
    async updateTokenStatus(tokenId, action) {
        return this.request('/api/admin-tokens', {
            method: 'PATCH',
            body: JSON.stringify({ token_id: tokenId, action })
        });
    }

    /**
     * Delete token (admin)
     */
    async deleteToken(tokenId) {
        return this.request(`/api/admin-tokens?id=${tokenId}`, {
            method: 'DELETE'
        });
    }
}

// Create global instance
const api = new APIClient(auth);
