/**
 * MoneyIndex Payment Manager
 * DUMMY payment gateway for testing
 * Replace with Razorpay integration later
 */

class PaymentManager {
    constructor(apiClient, authManager) {
        this.api = apiClient;
        this.auth = authManager;
        this.isProcessing = false;
    }

    /**
     * Initialize dummy payment flow
     */
    async initPayment() {
        if (this.isProcessing) {
            throw new Error('Payment already in progress');
        }

        // Check if user is logged in
        if (!this.auth.isLoggedIn()) {
            throw new Error('Please login to make a payment');
        }

        this.isProcessing = true;

        try {
            // Step 1: Create order via backend
            const orderData = await this.api.createPaymentOrder();

            // Step 2: Show dummy payment confirmation
            const confirmed = await this.showDummyCheckout(orderData);

            if (!confirmed) {
                throw new Error('Payment cancelled');
            }

            // Step 3: Verify payment (auto-approves in dummy mode)
            const result = await this.api.verifyPayment({
                order_id: orderData.order_id
            });

            // Step 4: Refresh auth profile
            await this.auth.loadProfile();

            return result;

        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Show dummy payment confirmation modal
     */
    showDummyCheckout(orderData) {
        return new Promise((resolve) => {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.id = 'dummy-payment-overlay';
            overlay.style.cssText = `
                position: fixed; inset: 0; z-index: 10000;
                background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
                display: flex; align-items: center; justify-content: center;
                font-family: 'Inter', sans-serif;
            `;

            const amount = (orderData.amount / 100).toFixed(0);
            const name = orderData.prefill?.name || '';
            const email = orderData.prefill?.email || '';

            overlay.innerHTML = `
                <div style="
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid rgba(99,102,241,0.3);
                    border-radius: 16px; padding: 32px; max-width: 420px; width: 90%;
                    box-shadow: 0 25px 50px rgba(0,0,0,0.5); color: #fff;
                ">
                    <div style="text-align:center; margin-bottom: 24px;">
                        <div style="
                            width: 56px; height: 56px; margin: 0 auto 16px;
                            background: linear-gradient(135deg, #6366f1, #8b5cf6);
                            border-radius: 12px; display: flex; align-items: center;
                            justify-content: center; font-size: 24px;
                        ">💳</div>
                        <h2 style="margin:0 0 4px; font-size: 20px; font-weight: 700;">Demo Payment Gateway</h2>
                        <p style="margin:0; color: #94a3b8; font-size: 13px;">
                            This is a test payment. No real money will be charged.
                        </p>
                    </div>
                    
                    <div style="
                        background: rgba(255,255,255,0.05); border-radius: 12px;
                        padding: 16px; margin-bottom: 20px;
                    ">
                        <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                            <span style="color:#94a3b8">Product</span>
                            <span style="font-weight:600">${orderData.product_name || 'Premium'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                            <span style="color:#94a3b8">Amount</span>
                            <span style="font-weight:700; color: #22c55e; font-size: 18px;">₹${amount}</span>
                        </div>
                        ${name ? `<div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                            <span style="color:#94a3b8">Name</span>
                            <span>${name}</span>
                        </div>` : ''}
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:#94a3b8">Email</span>
                            <span style="font-size:13px">${email}</span>
                        </div>
                    </div>

                    <div style="
                        background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.3);
                        border-radius: 8px; padding: 10px 14px; margin-bottom: 20px;
                        font-size: 12px; color: #eab308; text-align: center;
                    ">
                        ⚠️ Demo Mode — Real Razorpay gateway will be integrated later
                    </div>

                    <div style="display: flex; gap: 12px;">
                        <button id="dummy-pay-cancel" style="
                            flex:1; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
                            background: transparent; color: #94a3b8; font-size: 14px; font-weight: 600;
                            cursor: pointer; transition: all 0.2s;
                        ">Cancel</button>
                        <button id="dummy-pay-confirm" style="
                            flex:2; padding: 12px; border-radius: 10px; border: none;
                            background: linear-gradient(135deg, #6366f1, #8b5cf6);
                            color: #fff; font-size: 14px; font-weight: 700;
                            cursor: pointer; transition: all 0.2s;
                        ">Pay ₹${amount} (Demo)</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Button handlers
            document.getElementById('dummy-pay-confirm').addEventListener('click', () => {
                overlay.remove();
                resolve(true);
            });

            document.getElementById('dummy-pay-cancel').addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });

            // Click outside to cancel
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            });
        });
    }

    /**
     * Format price for display
     */
    formatPrice(amount, currency = 'INR') {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: currency
        }).format(amount / 100);
    }
}

// Create global instance
const payment = new PaymentManager(api, auth);

/**
 * Initialize payment button
 */
function initPaymentButton(buttonSelector, options = {}) {
    const button = document.querySelector(buttonSelector);
    if (!button) return;

    button.addEventListener('click', async (e) => {
        e.preventDefault();

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Processing...';

        try {
            const result = await payment.initPayment();

            if (options.onSuccess) {
                options.onSuccess(result);
            } else {
                alert('Payment successful! Your subscription is now active.');
                window.location.href = '/dashboard.html';
            }

        } catch (err) {
            console.error('Payment error:', err);

            if (options.onError) {
                options.onError(err);
            } else {
                if (err.message !== 'Payment cancelled') {
                    alert(err.message || 'Payment failed. Please try again.');
                }
            }

        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });
}
