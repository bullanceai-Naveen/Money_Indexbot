const { getSupabaseAdmin } = require('./_shared/supabase');
const { isValidEmail } = require('./_shared/validation');
const { handleCORS, success, error, unauthorized, methodNotAllowed, serverError, parseBody, getClientIP } = require('./_shared/response');
const { rateLimitMiddleware } = require('./_shared/rate-limiter');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(['POST']);
    }

    // Rate limiting (stricter for auth)
    const rateLimited = rateLimitMiddleware(event, 'auth');
    if (rateLimited) return rateLimited;

    try {
        // Parse body
        const { data: body, error: parseError } = parseBody(event);
        if (parseError) return error(parseError);

        const { email, password } = body;

        // Basic validation
        if (!email || !isValidEmail(email)) {
            return error('Valid email is required');
        }

        if (!password) {
            return error('Password is required');
        }

        const supabase = getSupabaseAdmin();

        // Attempt sign in
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password
        });

        if (authError) {
            console.error('Login error:', authError.message);

            // Generic error message for security (don't reveal if email exists)
            return unauthorized('Invalid email or password');
        }

        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (profileError) {
            console.error('Profile fetch error:', profileError);
        }

        // Check and update subscription status if expired
        if (profile && profile.subscription_status === 'active' && profile.subscription_end) {
            if (new Date(profile.subscription_end) < new Date()) {
                await supabase
                    .from('profiles')
                    .update({ subscription_status: 'expired' })
                    .eq('id', authData.user.id);

                profile.subscription_status = 'expired';
            }
        }

        // Log login activity
        await supabase.from('user_activity').insert({
            user_id: authData.user.id,
            action: 'login',
            ip_address: getClientIP(event)
        });

        // Sanitize profile data (remove sensitive fields)
        const safeProfile = profile ? {
            subscription_status: profile.subscription_status || 'inactive',
            subscription_end: profile.subscription_end,
            full_name: profile.full_name,
            is_admin: profile.is_admin || false,
            telegram_linked: !!profile.telegram_chat_id
        } : {
            subscription_status: 'inactive',
            subscription_end: null,
            full_name: null,
            is_admin: false,
            telegram_linked: false
        };

        return success({
            message: 'Login successful',
            user: {
                id: authData.user.id,
                email: authData.user.email
            },
            profile: safeProfile,
            session: {
                access_token: authData.session.access_token,
                refresh_token: authData.session.refresh_token,
                expires_at: authData.session.expires_at,
                expires_in: authData.session.expires_in
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        return serverError('Login failed. Please try again later.');
    }
};
