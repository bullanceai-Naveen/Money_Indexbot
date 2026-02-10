const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { handleCORS, success, error, unauthorized, methodNotAllowed, serverError, getClientIP } = require('./_shared/response');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(['POST']);
    }

    try {
        // Verify user is authenticated
        const { user, error: authError } = await verifyAuth(event);

        if (authError) {
            // Even if auth fails, return success (they're already logged out)
            return success({ message: 'Logged out successfully' });
        }

        const supabase = getSupabaseAdmin();

        // Log logout activity
        if (user) {
            await supabase.from('user_activity').insert({
                user_id: user.id,
                action: 'logout',
                ip_address: getClientIP(event)
            });
        }

        // Note: Supabase JWTs are stateless, so we can't truly invalidate them server-side
        // The client should delete the tokens from storage
        // For enhanced security, you could implement a token blacklist in the database

        return success({
            message: 'Logged out successfully'
        });

    } catch (err) {
        console.error('Logout error:', err);
        // Still return success - user should be considered logged out
        return success({ message: 'Logged out successfully' });
    }
};
