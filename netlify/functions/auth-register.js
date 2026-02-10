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
            email_confirm: true
        });

        if (authError) {
            console.error('Auth creation error:', authError);

            if (authError.message.includes('already registered')) {
                return error('An account with this email already exists', 409);
            }

            return error(`Account creation failed: ${authError.message}`, 500);
        }

        // Manually ensure profile exists (in case the trigger didn't fire)
        const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', authData.user.id)
            .single();

        if (!existingProfile) {
            // Manually create profile since trigger may not have fired
            const { error: profileInsertError } = await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    email: validation.sanitized.email,
                    full_name: validation.sanitized.full_name || null,
                    phone: validation.sanitized.phone || null,
                    updated_at: new Date().toISOString()
                });

            if (profileInsertError) {
                console.error('Profile creation error:', profileInsertError);
                // User was created in auth but profile failed - still return success
                // Profile can be created on next login
            }
        } else {
            // Profile exists from trigger, update with additional info
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
        }

        // Log activity
        try {
            await supabase.from('user_activity').insert({
                user_id: authData.user.id,
                action: 'register',
                metadata: { method: 'email' },
                ip_address: event.headers['x-forwarded-for'] || 'unknown'
            });
        } catch (logErr) {
            console.error('Activity log error:', logErr);
            // Non-critical, continue
        }

        return success({
            message: 'Registration successful! Please login to continue.',
            user: {
                id: authData.user.id,
                email: authData.user.email
            }
        }, 201);

    } catch (err) {
        console.error('Registration error:', err);
        return serverError(`Registration failed: ${err.message}`);
    }
};
