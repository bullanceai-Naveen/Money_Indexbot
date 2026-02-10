/**
 * Simple in-memory rate limiter for serverless functions
 * Note: In production with multiple instances, use Redis or database-based rate limiting
 * For Netlify free tier (single instance), this works fine
 */

// In-memory storage for rate limits
const rateLimitStore = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
        if (now > data.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Rate limit configurations for different endpoint types
 */
const RATE_LIMITS = {
    // Authentication endpoints (stricter to prevent brute force)
    auth: {
        requests: 5,        // 5 attempts
        windowMs: 60000     // per minute
    },
    // Payment endpoints
    payment: {
        requests: 10,
        windowMs: 60000
    },
    // General API endpoints
    api: {
        requests: 100,
        windowMs: 60000
    },
    // Admin endpoints
    admin: {
        requests: 50,
        windowMs: 60000
    },
    // Contact form
    contact: {
        requests: 3,
        windowMs: 300000    // 3 per 5 minutes
    }
};

/**
 * Check if request is rate limited
 * @param {string} identifier - Unique identifier (IP or user ID)
 * @param {string} type - Type of rate limit ('auth', 'payment', 'api', 'admin', 'contact')
 * @returns {Object} { allowed: boolean, remaining: number, resetAt: number, retryAfter: number }
 */
function checkRateLimit(identifier, type = 'api') {
    const config = RATE_LIMITS[type] || RATE_LIMITS.api;
    const key = `${type}:${identifier}`;
    const now = Date.now();

    // Get or create rate limit data
    let data = rateLimitStore.get(key);

    if (!data || now > data.resetAt) {
        // Create new window
        data = {
            count: 0,
            resetAt: now + config.windowMs
        };
    }

    // Increment count
    data.count++;
    rateLimitStore.set(key, data);

    const remaining = Math.max(0, config.requests - data.count);
    const retryAfter = Math.ceil((data.resetAt - now) / 1000);

    if (data.count > config.requests) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: data.resetAt,
            retryAfter
        };
    }

    return {
        allowed: true,
        remaining,
        resetAt: data.resetAt,
        retryAfter: 0
    };
}

/**
 * Rate limit middleware for Netlify functions
 * @param {Object} event - Netlify function event
 * @param {string} type - Rate limit type
 * @returns {Object|null} Rate limit error response or null if allowed
 */
function rateLimitMiddleware(event, type = 'api') {
    const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               event.headers['x-real-ip'] ||
               'unknown';

    const result = checkRateLimit(ip, type);

    if (!result.allowed) {
        return {
            statusCode: 429,
            headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(result.retryAfter),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000))
            },
            body: JSON.stringify({
                error: 'Too many requests. Please try again later.',
                retryAfter: result.retryAfter
            })
        };
    }

    return null;
}

/**
 * Add rate limit headers to response
 * @param {Object} response - Netlify function response
 * @param {string} identifier - Unique identifier
 * @param {string} type - Rate limit type
 * @returns {Object} Response with rate limit headers
 */
function addRateLimitHeaders(response, identifier, type = 'api') {
    const config = RATE_LIMITS[type] || RATE_LIMITS.api;
    const key = `${type}:${identifier}`;
    const data = rateLimitStore.get(key);

    if (data) {
        const remaining = Math.max(0, config.requests - data.count);
        response.headers = {
            ...response.headers,
            'X-RateLimit-Limit': String(config.requests),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(Math.ceil(data.resetAt / 1000))
        };
    }

    return response;
}

module.exports = {
    RATE_LIMITS,
    checkRateLimit,
    rateLimitMiddleware,
    addRateLimitHeaders
};
