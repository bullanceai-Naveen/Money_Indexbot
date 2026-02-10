const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAdmin } = require('./_shared/auth');
const { handleCORS, success, error, unauthorized, forbidden, methodNotAllowed, serverError } = require('./_shared/response');

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow GET
    if (event.httpMethod !== 'GET') {
        return methodNotAllowed(['GET']);
    }

    try {
        // Verify admin access
        const { user, profile, error: authError } = await verifyAdmin(event);

        if (authError) {
            if (authError === 'Admin access required') {
                return forbidden(authError);
            }
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();

        // Get today's date for daily stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();

        // Get this month's start
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthStartISO = monthStart.toISOString();

        // Fetch all stats in parallel
        const [
            totalUsersResult,
            activeSubsResult,
            expiredSubsResult,
            paymentsResult,
            monthlyPaymentsResult,
            todayLoginsResult,
            todaySignupsResult,
            messagesResult,
            recentUsersResult,
            recentPaymentsResult
        ] = await Promise.all([
            // Total users
            supabase.from('profiles').select('*', { count: 'exact', head: true }),

            // Active subscriptions
            supabase.from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_status', 'active')
                .gt('subscription_end', new Date().toISOString()),

            // Expired subscriptions
            supabase.from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_status', 'expired'),

            // Total revenue (all time)
            supabase.from('payments')
                .select('amount')
                .eq('status', 'paid'),

            // Monthly revenue
            supabase.from('payments')
                .select('amount')
                .eq('status', 'paid')
                .gte('created_at', monthStartISO),

            // Today's logins
            supabase.from('user_activity')
                .select('*', { count: 'exact', head: true })
                .eq('action', 'login')
                .gte('created_at', todayISO),

            // Today's signups
            supabase.from('profiles')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', todayISO),

            // Unread messages
            supabase.from('contact_messages')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'new'),

            // Recent users (last 10)
            supabase.from('profiles')
                .select('id, email, full_name, subscription_status, created_at')
                .order('created_at', { ascending: false })
                .limit(10),

            // Recent payments (last 10)
            supabase.from('payments')
                .select('id, amount, status, created_at, profiles!inner(email)')
                .eq('status', 'paid')
                .order('created_at', { ascending: false })
                .limit(10)
        ]);

        // Calculate totals
        const totalRevenue = (paymentsResult.data || [])
            .reduce((sum, p) => sum + (p.amount || 0), 0) / 100;

        const monthlyRevenue = (monthlyPaymentsResult.data || [])
            .reduce((sum, p) => sum + (p.amount || 0), 0) / 100;

        return success({
            overview: {
                total_users: totalUsersResult.count || 0,
                active_subscriptions: activeSubsResult.count || 0,
                expired_subscriptions: expiredSubsResult.count || 0,
                total_revenue: totalRevenue,
                monthly_revenue: monthlyRevenue,
                unread_messages: messagesResult.count || 0
            },
            today: {
                logins: todayLoginsResult.count || 0,
                signups: todaySignupsResult.count || 0
            },
            recent: {
                users: (recentUsersResult.data || []).map(u => ({
                    id: u.id,
                    email: u.email,
                    full_name: u.full_name,
                    subscription_status: u.subscription_status,
                    created_at: u.created_at
                })),
                payments: (recentPaymentsResult.data || []).map(p => ({
                    id: p.id,
                    email: p.profiles?.email,
                    amount: p.amount / 100,
                    status: p.status,
                    created_at: p.created_at
                }))
            },
            generated_at: new Date().toISOString()
        });

    } catch (err) {
        console.error('Admin stats error:', err);
        return serverError('Failed to fetch statistics.');
    }
};
