const { getSupabaseAdmin } = require('./_shared/supabase');
const { validateRegistration } = require('./_shared/validation');
const { handleCORS, success, error, validationError, methodNotAllowed, serverError, parseBody } = require('./_shared/response');
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

        // Validate input
        const validation = validateRegistration(body);
        if (!validation.valid) {
            return validationError(validation.errors);
        }

        const supabase = getSupabaseAdmin();

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', validation.sanitized.email)
            .single();

        if (existingUser) {
            return error('An account with this email already exists', 409);
        }

        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: validation.sanitized.email,
            password: body.password,
            email_confirm: true // Auto-confirm for now (can enable email verification later)
        });

        if (authError) {
            console.error('Auth creation error:', authError);

            if (authError.message.includes('already registered')) {
                return error('An account with this email already exists', 409);
            }

            // Temporary debug info - remove in production
            return error(`Account creation failed: ${authError.message || JSON.stringify(authError)}`, 500);
        }

        // Update profile with additional info
        const profileUpdate = {
            updated_at: new Date().toISOString()
        };

        if (validation.sanitized.full_name) {
            profileUpdate.full_name = validation.sanitized.full_name;
        }

        if (validation.sanitized.phone) {
            profileUpdate.phone = validation.sanitized.phone;
        }

        await supabase
            .from('profiles')
            .update(profileUpdate)
            .eq('id', authData.user.id);

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: authData.user.id,
            action: 'register',
            metadata: { method: 'email' },
            ip_address: event.headers['x-forwarded-for'] || 'unknown'
        });

        return success({
            message: 'Registration successful! Please login to continue.',
            user: {
                id: authData.user.id,
                email: authData.user.email
            }
        }, 201);

    } catch (err) {
        console.error('Registration error:', err);
        return serverError(`Registration failed: ${err.message || JSON.stringify(err)}`);
    }
};
