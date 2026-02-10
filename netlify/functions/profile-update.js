const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { validateProfileUpdate } = require('./_shared/validation');
const { handleCORS, success, error, unauthorized, validationError, methodNotAllowed, serverError, parseBody, getClientIP } = require('./_shared/response');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow POST/PUT/PATCH
    if (!['POST', 'PUT', 'PATCH'].includes(event.httpMethod)) {
        return methodNotAllowed(['POST', 'PUT', 'PATCH']);
    }

    try {
        // Verify authentication
        const { user, error: authError } = await verifyAuth(event);

        if (authError) {
            return unauthorized(authError);
        }

        // Parse body
        const { data: body, error: parseError } = parseBody(event);
        if (parseError) return error(parseError);

        // Validate input
        const validation = validateProfileUpdate(body);
        if (!validation.valid) {
            return validationError(validation.errors);
        }

        const supabase = getSupabaseAdmin();

        // Build update object (only include fields that were provided)
        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (validation.sanitized.full_name !== undefined) {
            updateData.full_name = validation.sanitized.full_name;
        }

        if (validation.sanitized.phone !== undefined) {
            updateData.phone = validation.sanitized.phone;
        }

        if (validation.sanitized.telegram_chat_id !== undefined) {
            updateData.telegram_chat_id = validation.sanitized.telegram_chat_id;
        }

        // Update profile
        const { data: profile, error: updateError } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', user.id)
            .select('id, email, full_name, phone, telegram_chat_id, subscription_status, subscription_end, updated_at')
            .single();

        if (updateError) {
            console.error('Profile update error:', updateError);
            return error('Failed to update profile');
        }

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: user.id,
            action: 'profile_update',
            metadata: { fields_updated: Object.keys(updateData).filter(k => k !== 'updated_at') },
            ip_address: getClientIP(event)
        });

        return success({
            message: 'Profile updated successfully',
            profile
        });

    } catch (err) {
        console.error('Profile update error:', err);
        return serverError('Failed to update profile. Please try again.');
    }
};
