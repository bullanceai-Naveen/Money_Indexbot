const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAdmin } = require('./_shared/auth');
const { encrypt, decrypt } = require('./_shared/encryption');
const { handleCORS, success, error, unauthorized, forbidden, methodNotAllowed, serverError, parseBody, getClientIP } = require('./_shared/response');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Allow GET, POST, PATCH, DELETE
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(event.httpMethod)) {
        return methodNotAllowed(['GET', 'POST', 'PATCH', 'DELETE']);
    }

    try {
        // Verify admin access
        const { user: adminUser, error: authError } = await verifyAdmin(event);

        if (authError) {
            if (authError === 'Admin access required') {
                return forbidden(authError);
            }
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();

        // GET - List tokens (without decrypted values)
        if (event.httpMethod === 'GET') {
            const { data: tokens, error: queryError } = await supabase
                .from('access_tokens')
                .select('id, token_name, is_active, last_used, expires_at, created_at')
                .order('created_at', { ascending: false });

            if (queryError) {
                console.error('Tokens query error:', queryError);
                return serverError('Failed to fetch tokens');
            }

            return success({
                tokens: tokens || [],
                note: 'Token values are encrypted and not shown for security'
            });
        }

        // POST - Add new token
        if (event.httpMethod === 'POST') {
            const { data: body, error: parseError } = parseBody(event);
            if (parseError) return error(parseError);

            const { token, token_name, expires_at } = body;

            if (!token) {
                return error('token is required');
            }

            // Validate token format (basic check)
            if (token.length < 50) {
                return error('Token appears to be invalid (too short)');
            }

            // Encrypt the token
            let encryptedToken;
            try {
                encryptedToken = encrypt(token);
            } catch (encryptError) {
                console.error('Token encryption failed:', encryptError);
                return serverError('Failed to encrypt token. Check ENCRYPTION_KEY configuration.');
            }

            // Deactivate all existing tokens if this is the new primary
            if (!token_name || token_name === 'primary') {
                await supabase
                    .from('access_tokens')
                    .update({ is_active: false })
                    .eq('is_active', true);
            }

            // Insert new token
            const { data: newToken, error: insertError } = await supabase
                .from('access_tokens')
                .insert({
                    token_encrypted: encryptedToken,
                    token_name: token_name || 'primary',
                    is_active: true,
                    expires_at: expires_at || null
                })
                .select('id, token_name, is_active, created_at')
                .single();

            if (insertError) {
                console.error('Token insert error:', insertError);
                return error('Failed to save token');
            }

            // Log action
            await supabase.from('user_activity').insert({
                user_id: adminUser.id,
                action: 'admin_add_token',
                metadata: {
                    token_id: newToken.id,
                    token_name: newToken.token_name
                },
                ip_address: getClientIP(event)
            });

            return success({
                message: 'Token added successfully',
                token: newToken
            }, 201);
        }

        // PATCH - Update token (activate/deactivate)
        if (event.httpMethod === 'PATCH') {
            const { data: body, error: parseError } = parseBody(event);
            if (parseError) return error(parseError);

            const { token_id, action } = body;

            if (!token_id) {
                return error('token_id is required');
            }

            const update = {};

            switch (action) {
                case 'activate':
                    // Deactivate all others first
                    await supabase
                        .from('access_tokens')
                        .update({ is_active: false })
                        .neq('id', token_id);

                    update.is_active = true;
                    break;

                case 'deactivate':
                    update.is_active = false;
                    break;

                default:
                    return error('Invalid action. Use: activate, deactivate');
            }

            const { data: updatedToken, error: updateError } = await supabase
                .from('access_tokens')
                .update(update)
                .eq('id', token_id)
                .select('id, token_name, is_active')
                .single();

            if (updateError) {
                console.error('Token update error:', updateError);
                return error('Failed to update token');
            }

            // Log action
            await supabase.from('user_activity').insert({
                user_id: adminUser.id,
                action: `admin_${action}_token`,
                metadata: { token_id },
                ip_address: getClientIP(event)
            });

            return success({
                message: `Token ${action}d successfully`,
                token: updatedToken
            });
        }

        // DELETE - Remove token
        if (event.httpMethod === 'DELETE') {
            const params = event.queryStringParameters || {};
            const tokenId = params.id;

            if (!tokenId) {
                return error('Token ID is required (pass as ?id=xxx)');
            }

            // Check if it's the only active token
            const { data: activeTokens } = await supabase
                .from('access_tokens')
                .select('id')
                .eq('is_active', true);

            const { data: targetToken } = await supabase
                .from('access_tokens')
                .select('id, is_active')
                .eq('id', tokenId)
                .single();

            if (targetToken?.is_active && activeTokens?.length === 1) {
                return error('Cannot delete the only active token. Add a new token first.');
            }

            const { error: deleteError } = await supabase
                .from('access_tokens')
                .delete()
                .eq('id', tokenId);

            if (deleteError) {
                console.error('Token delete error:', deleteError);
                return error('Failed to delete token');
            }

            // Log action
            await supabase.from('user_activity').insert({
                user_id: adminUser.id,
                action: 'admin_delete_token',
                metadata: { token_id: tokenId },
                ip_address: getClientIP(event)
            });

            return success({
                message: 'Token deleted successfully'
            });
        }

    } catch (err) {
        console.error('Admin tokens error:', err);
        return serverError('An error occurred.');
    }
};
