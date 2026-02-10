const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAdmin } = require('./_shared/auth');
const { handleCORS, success, error, unauthorized, forbidden, methodNotAllowed, serverError, parseBody, getClientIP } = require('./_shared/response');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Allow GET (list users) and PATCH (update user)
    if (!['GET', 'PATCH'].includes(event.httpMethod)) {
        return methodNotAllowed(['GET', 'PATCH']);
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

        // GET - List users
        if (event.httpMethod === 'GET') {
            const params = event.queryStringParameters || {};

            const page = Math.max(1, parseInt(params.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
            const offset = (page - 1) * limit;

            // Build query
            let query = supabase
                .from('profiles')
                .select('id, email, full_name, phone, subscription_status, subscription_start, subscription_end, is_admin, telegram_chat_id, created_at, updated_at', { count: 'exact' });

            // Filter by subscription status
            if (params.status) {
                query = query.eq('subscription_status', params.status);
            }

            // Search by email or name
            if (params.search) {
                query = query.or(`email.ilike.%${params.search}%,full_name.ilike.%${params.search}%`);
            }

            // Order and paginate
            query = query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            const { data: users, count, error: queryError } = await query;

            if (queryError) {
                console.error('Users query error:', queryError);
                return serverError('Failed to fetch users');
            }

            return success({
                users: users || [],
                pagination: {
                    page,
                    limit,
                    total: count || 0,
                    pages: Math.ceil((count || 0) / limit)
                }
            });
        }

        // PATCH - Update user
        if (event.httpMethod === 'PATCH') {
            const { data: body, error: parseError } = parseBody(event);
            if (parseError) return error(parseError);

            const { user_id, action, ...updateData } = body;

            if (!user_id) {
                return error('user_id is required');
            }

            // Check if target user exists
            const { data: targetUser, error: findError } = await supabase
                .from('profiles')
                .select('id, email, subscription_status')
                .eq('id', user_id)
                .single();

            if (findError || !targetUser) {
                return error('User not found', 404);
            }

            let update = {};
            let logAction = '';

            switch (action) {
                case 'activate_subscription': {
                    // Manually activate subscription (e.g., for free trial or gift)
                    const days = parseInt(updateData.days) || 30;
                    const endDate = new Date();
                    endDate.setDate(endDate.getDate() + days);

                    update = {
                        subscription_status: 'active',
                        subscription_start: new Date().toISOString(),
                        subscription_end: endDate.toISOString()
                    };
                    logAction = `activate_subscription_${days}_days`;
                    break;
                }

                case 'deactivate_subscription': {
                    update = {
                        subscription_status: 'inactive'
                    };
                    logAction = 'deactivate_subscription';
                    break;
                }

                case 'extend_subscription': {
                    const days = parseInt(updateData.days) || 30;
                    let newEnd;

                    if (targetUser.subscription_status === 'active') {
                        // Extend from current end date
                        const { data: profile } = await supabase
                            .from('profiles')
                            .select('subscription_end')
                            .eq('id', user_id)
                            .single();

                        const currentEnd = profile?.subscription_end ? new Date(profile.subscription_end) : new Date();
                        newEnd = new Date(currentEnd);
                        newEnd.setDate(newEnd.getDate() + days);
                    } else {
                        // Start fresh
                        newEnd = new Date();
                        newEnd.setDate(newEnd.getDate() + days);
                    }

                    update = {
                        subscription_status: 'active',
                        subscription_end: newEnd.toISOString()
                    };
                    logAction = `extend_subscription_${days}_days`;
                    break;
                }

                case 'toggle_admin': {
                    // Prevent removing own admin status
                    if (user_id === adminUser.id) {
                        return error('Cannot modify your own admin status');
                    }

                    const { data: currentProfile } = await supabase
                        .from('profiles')
                        .select('is_admin')
                        .eq('id', user_id)
                        .single();

                    update = {
                        is_admin: !currentProfile?.is_admin
                    };
                    logAction = update.is_admin ? 'grant_admin' : 'revoke_admin';
                    break;
                }

                default:
                    return error('Invalid action. Supported: activate_subscription, deactivate_subscription, extend_subscription, toggle_admin');
            }

            // Perform update
            update.updated_at = new Date().toISOString();

            const { data: updatedUser, error: updateError } = await supabase
                .from('profiles')
                .update(update)
                .eq('id', user_id)
                .select('id, email, subscription_status, subscription_end, is_admin')
                .single();

            if (updateError) {
                console.error('User update error:', updateError);
                return error('Failed to update user');
            }

            // Log admin action
            await supabase.from('user_activity').insert({
                user_id: adminUser.id,
                action: `admin_${logAction}`,
                metadata: {
                    target_user_id: user_id,
                    target_email: targetUser.email,
                    changes: update
                },
                ip_address: getClientIP(event)
            });

            return success({
                message: 'User updated successfully',
                user: updatedUser
            });
        }

    } catch (err) {
        console.error('Admin users error:', err);
        return serverError('An error occurred.');
    }
};
