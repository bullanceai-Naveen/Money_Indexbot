const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifyAuth } = require('./_shared/auth');
const { handleCORS, success, error, unauthorized, methodNotAllowed, serverError, parseBody, getClientIP } = require('./_shared/response');
const { rateLimitMiddleware } = require('./_shared/rate-limiter');

/**
 * DUMMY Payment Gateway - Verify Payment
 * Always succeeds for testing. Replace with Razorpay verification later.
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
            return unauthorized('Please login to verify payment');
        }

        // Parse body
        const { data: body, error: parseError } = parseBody(event);
        if (parseError) return error(parseError);

        const { order_id } = body;

        if (!order_id) {
            return error('Missing order ID');
        }

        const supabase = getSupabaseAdmin();

        // Find the payment record
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .select('*')
            .eq('razorpay_order_id', order_id)
            .eq('user_id', user.id)
            .single();

        if (paymentError || !payment) {
            return error('Payment order not found', 404);
        }

        if (payment.status === 'paid') {
            return error('Payment already verified', 400);
        }

        // DUMMY: Auto-approve payment
        const dummyPaymentId = `dummy_pay_${Date.now()}`;

        // Update payment record
        const { error: updateError } = await supabase
            .from('payments')
            .update({
                razorpay_payment_id: dummyPaymentId,
                razorpay_signature: 'dummy_signature',
                status: 'paid'
            })
            .eq('id', payment.id);

        if (updateError) {
            console.error('Failed to update payment:', updateError);
        }

        // Calculate subscription dates
        const now = new Date();
        let subscriptionEnd;

        // Get current profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_end')
            .eq('id', user.id)
            .single();

        // Extend if existing active subscription
        if (profile?.subscription_end && new Date(profile.subscription_end) > now) {
            subscriptionEnd = new Date(profile.subscription_end);
            subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
        } else {
            subscriptionEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        }

        // Activate subscription
        const { error: profileError } = await supabase
            .from('profiles')
            .update({
                subscription_status: 'active',
                subscription_start: now.toISOString(),
                subscription_end: subscriptionEnd.toISOString(),
                updated_at: now.toISOString()
            })
            .eq('id', user.id);

        if (profileError) {
            console.error('Failed to update subscription:', profileError);
            return success({
                success: true,
                message: 'Payment successful! Your subscription will be activated shortly.',
                payment_id: dummyPaymentId,
                gateway: 'dummy',
                subscription_end: subscriptionEnd.toISOString(),
                note: 'If your subscription is not activated within 24 hours, please contact support.'
            });
        }

        // Log activity
        await supabase.from('user_activity').insert({
            user_id: user.id,
            action: 'payment_success',
            metadata: {
                order_id: order_id,
                payment_id: dummyPaymentId,
                amount: payment.amount,
                gateway: 'dummy',
                subscription_end: subscriptionEnd.toISOString()
            },
            ip_address: getClientIP(event)
        });

        return success({
            success: true,
            message: '[DEMO] Payment verified successfully! Your subscription is now active.',
            payment_id: dummyPaymentId,
            gateway: 'dummy',
            subscription: {
                status: 'active',
                start: now.toISOString(),
                end: subscriptionEnd.toISOString()
            }
        });

    } catch (err) {
        console.error('Payment verification error:', err);
        return serverError('Payment verification failed. Please contact support.');
    }
};
