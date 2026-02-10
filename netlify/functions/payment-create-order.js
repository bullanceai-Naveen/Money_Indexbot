const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { handleCORS, success, error, unauthorized, methodNotAllowed, serverError, getClientIP } = require('./_shared/response');
const { rateLimitMiddleware } = require('./_shared/rate-limiter');

/**
 * DUMMY Payment Gateway - Create Order
 * Replace with Razorpay integration later
 */
exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(['POST']);
    }

    // Rate limiting
    const rateLimited = rateLimitMiddleware(event, 'payment');
    if (rateLimited) return rateLimited;

    try {
        // Verify user is authenticated
        const { user, error: authError } = await verifyAuth(event);

        if (authError) {
            return unauthorized('Please login to make a payment');
        }

        const supabase = getSupabaseAdmin();

        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('email, full_name, phone, subscription_status, subscription_end')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return error('User profile not found');
        }

        // Check if already has active subscription
        if (profile.subscription_status === 'active' && profile.subscription_end) {
            const endDate = new Date(profile.subscription_end);
            if (endDate > new Date()) {
                return error(`You already have an active subscription until ${endDate.toLocaleDateString('en-IN')}`, 400);
            }
        }

        // Get product details
        const amount = parseInt(process.env.PRODUCT_PRICE_PAISE) || 49900;
        const productName = process.env.PRODUCT_NAME || 'MoneyIndex Premium - 30 Days';

        // Generate dummy order ID
        const orderId = `dummy_order_${user.id.substring(0, 8)}_${Date.now()}`;

        // Store order in database
        const { error: insertError } = await supabase.from('payments').insert({
            user_id: user.id,
            razorpay_order_id: orderId,
            amount: amount,
            currency: 'INR',
            status: 'created'
        });

        if (insertError) {
            console.error('Failed to store order:', insertError);
        }

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: user.id,
            action: 'payment_initiated',
            metadata: { order_id: orderId, amount: amount, gateway: 'dummy' },
            ip_address: getClientIP(event)
        });

        return success({
            order_id: orderId,
            amount: amount,
            currency: 'INR',
            gateway: 'dummy',
            product_name: productName,
            prefill: {
                name: profile.full_name || '',
                email: profile.email,
                contact: profile.phone || ''
            }
        });

    } catch (err) {
        console.error('Payment order creation error:', err);
        return serverError('Failed to create payment order. Please try again.');
    }
};
