const { success, methodNotAllowed } = require('./_shared/response');

/**
 * DUMMY Payment Webhook
 * Placeholder for future Razorpay webhook integration.
 * Currently just acknowledges requests.
 */
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(['POST']);
    }

    console.log('Dummy webhook received:', event.body);

    return success({
        received: true,
        gateway: 'dummy',
        message: 'Webhook placeholder - Razorpay integration pending'
    });
};
