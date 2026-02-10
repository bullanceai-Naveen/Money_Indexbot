const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { handleCORS, success, error, unauthorized, methodNotAllowed, serverError } = require('./_shared/response');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow GET
    if (event.httpMethod !== 'GET') {
        return methodNotAllowed(['GET']);
    }

    try {
        // Verify authentication
        const { user, error: authError } = await verifyAuth(event);

        if (authError) {
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();

        // Get full profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return error('Profile not found', 404);
        }

        // Check and update subscription status if expired
        if (profile.subscription_status === 'active' && profile.subscription_end) {
            if (new Date(profile.subscription_end) < new Date()) {
                await supabase
                    .from('profiles')
                    .update({ subscription_status: 'expired' })
                    .eq('id', user.id);

                profile.subscription_status = 'expired';
            }
        }

        // Get payment history
        const { data: payments } = await supabase
            .from('payments')
            .select('id, amount, currency, status, created_at')
            .eq('user_id', user.id)
            .eq('status', 'paid')
            .order('created_at', { ascending: false })
            .limit(10);

        // Sanitize profile (remove sensitive fields)
        const safeProfile = {
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            phone: profile.phone,
            telegram_chat_id: profile.telegram_chat_id,
            subscription_status: profile.subscription_status,
            subscription_start: profile.subscription_start,
            subscription_end: profile.subscription_end,
            is_admin: profile.is_admin,
            created_at: profile.created_at,
            updated_at: profile.updated_at
        };

        return success({
            profile: safeProfile,
            payments: payments || [],
            subscription: {
                status: profile.subscription_status,
                start: profile.subscription_start,
                end: profile.subscription_end,
                is_active: profile.subscription_status === 'active' &&
                           profile.subscription_end &&
                           new Date(profile.subscription_end) > new Date()
            }
        });

    } catch (err) {
        console.error('Profile fetch error:', err);
        return serverError('Failed to fetch profile. Please try again.');
    }
};
