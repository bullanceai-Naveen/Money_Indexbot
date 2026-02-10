const { getSupabaseAdmin } = require('./supabase');

/**
 * Verify user authentication from request headers
 * @param {Object} event - Netlify function event
 * @returns {Object} { user, error }
 */
async function verifyAuth(event) {
    const authHeader = event.headers.authorization || event.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { user: null, profile: null, error: 'No authorization header' };
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseAdmin();

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return { user: null, profile: null, error: 'Invalid or expired token' };
        }

        return { user, profile: null, error: null };
    } catch (err) {
        console.error('Auth verification error:', err);
        return { user: null, profile: null, error: 'Authentication failed' };
    }
}

/**
 * Verify user has an active subscription
 * @param {Object} event - Netlify function event
 * @returns {Object} { user, profile, error }
 */
async function verifySubscription(event) {
    const { user, error: authError } = await verifyAuth(event);

    if (authError) {
        return { user: null, profile: null, error: authError };
    }

    const supabase = getSupabaseAdmin();

    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return { user, profile: null, error: 'Profile not found' };
        }

        // Check subscription status
        if (profile.subscription_status !== 'active') {
            return { user, profile, error: 'Subscription inactive. Please subscribe to access this feature.' };
        }

        // Check subscription expiry
        if (profile.subscription_end && new Date(profile.subscription_end) < new Date()) {
            // Update status to expired
            await supabase
                .from('profiles')
                .update({ subscription_status: 'expired' })
                .eq('id', user.id);

            return { user, profile, error: 'Subscription expired. Please renew to continue.' };
        }

        return { user, profile, error: null };
    } catch (err) {
        console.error('Subscription verification error:', err);
        return { user, profile: null, error: 'Failed to verify subscription' };
    }
}

/**
 * Verify user is an admin
 * @param {Object} event - Netlify function event
 * @returns {Object} { user, profile, error }
 */
async function verifyAdmin(event) {
    const { user, profile, error: subError } = await verifySubscription(event);

    if (subError) {
        return { user, profile, error: subError };
    }

    if (!profile.is_admin) {
        return { user, profile, error: 'Admin access required' };
    }

    return { user, profile, error: null };
}

/**
 * Extract user ID from token without full verification (for logging)
 * @param {Object} event - Netlify function event
 * @returns {string|null} User ID or null
 */
function extractUserId(event) {
    const authHeader = event.headers.authorization || event.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    try {
        const token = authHeader.replace('Bearer ', '');
        // JWT payload is the second part (base64 encoded)
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload.sub || null;
    } catch (err) {
        return null;
    }
}

module.exports = {
    verifyAuth,
    verifySubscription,
    verifyAdmin,
    extractUserId
};
