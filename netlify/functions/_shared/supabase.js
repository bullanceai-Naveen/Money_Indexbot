const { createClient } = require('@supabase/supabase-js');

/**
 * Get Supabase client for authenticated user requests
 * Uses anon key and respects Row Level Security (RLS)
 * @param {string} accessToken - User's JWT access token
 * @returns {SupabaseClient}
 */
function getSupabaseClient(accessToken = null) {
    const options = accessToken ? {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }
    } : {};

    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        options
    );
}

/**
 * Get Supabase admin client that bypasses RLS
 * Use carefully - only for server-side operations that need full access
 * @returns {SupabaseClient}
 */
function getSupabaseAdmin() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    );
}

module.exports = {
    getSupabaseClient,
    getSupabaseAdmin
};
