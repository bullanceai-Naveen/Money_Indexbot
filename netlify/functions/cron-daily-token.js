const { getSupabaseAdmin } = require('./_shared/supabase');
const { decrypt } = require('./_shared/encryption');

/**
 * Send message via Telegram Bot API
 */
async function sendTelegramMessage(chatId, message, parseMode = 'HTML') {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        console.error('TELEGRAM_BOT_TOKEN not configured');
        return false;
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: parseMode,
                disable_web_page_preview: true
            })
        });

        const data = await response.json();

        if (!data.ok) {
            console.error(`Telegram error for ${chatId}:`, data.description);
            return false;
        }

        return true;
    } catch (err) {
        console.error(`Failed to send Telegram message to ${chatId}:`, err);
        return false;
    }
}

/**
 * Send message to admin
 */
async function notifyAdmin(message) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (adminChatId) {
        await sendTelegramMessage(adminChatId, message);
    }
}

/**
 * Format token message
 */
function formatTokenMessage(token, subscriberName) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return `
🔑 <b>Daily Upstox Access Token</b>

${subscriberName ? `Hi ${subscriberName}! ` : ''}Here's your token for today:

<code>${token}</code>

📅 <b>Date:</b> ${dateStr}
⏰ <b>Valid:</b> Until market close (3:30 PM IST)

<b>How to use:</b>
1. Copy the token above (tap to select)
2. Open MoneyIndex dashboard
3. The token is auto-configured

📊 Happy Trading!

<i>— MoneyIndex Team</i>
    `.trim();
}

exports.handler = async (event, context) => {
    console.log('🕐 Daily token delivery cron job started');
    console.log('Time:', new Date().toISOString());

    const startTime = Date.now();
    const results = {
        success: 0,
        failed: 0,
        skipped: 0,
        errors: []
    };

    try {
        const supabase = getSupabaseAdmin();

        // Get active token
        const { data: tokens, error: tokenError } = await supabase
            .from('access_tokens')
            .select('id, token_encrypted, token_name')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1);

        if (tokenError || !tokens || tokens.length === 0) {
            const errorMsg = '⚠️ <b>ALERT: No Active Token!</b>\n\nThe daily token delivery failed because no active Upstox token is configured.\n\nPlease update the token immediately!';
            await notifyAdmin(errorMsg);

            console.error('No active token found');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: false,
                    error: 'No active token configured',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Decrypt token
        let decryptedToken;
        try {
            decryptedToken = decrypt(tokens[0].token_encrypted);
        } catch (decryptError) {
            const errorMsg = '❌ <b>Token Decryption Failed!</b>\n\nUnable to decrypt the stored access token. Please check the ENCRYPTION_KEY configuration.';
            await notifyAdmin(errorMsg);

            console.error('Token decryption failed:', decryptError);
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: false,
                    error: 'Token decryption failed',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Get all active subscribers with Telegram linked
        const { data: subscribers, error: subError } = await supabase
            .from('profiles')
            .select('id, telegram_chat_id, full_name, email')
            .eq('subscription_status', 'active')
            .not('telegram_chat_id', 'is', null)
            .gt('subscription_end', new Date().toISOString());

        if (subError) {
            console.error('Failed to fetch subscribers:', subError);
            await notifyAdmin('❌ <b>Database Error</b>\n\nFailed to fetch subscriber list for token delivery.');

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: false,
                    error: 'Database error',
                    timestamp: new Date().toISOString()
                })
            };
        }

        if (!subscribers || subscribers.length === 0) {
            console.log('No subscribers with Telegram linked');
            await notifyAdmin('📊 <b>Daily Token Delivery</b>\n\nNo active subscribers with Telegram linked. Token delivery skipped.');

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'No subscribers to notify',
                    timestamp: new Date().toISOString()
                })
            };
        }

        console.log(`Sending token to ${subscribers.length} subscribers`);

        // Send token to each subscriber
        for (const subscriber of subscribers) {
            try {
                const message = formatTokenMessage(decryptedToken, subscriber.full_name);
                const sent = await sendTelegramMessage(subscriber.telegram_chat_id, message);

                if (sent) {
                    results.success++;

                    // Log successful delivery
                    await supabase.from('user_activity').insert({
                        user_id: subscriber.id,
                        action: 'token_delivered',
                        metadata: { method: 'telegram', token_name: tokens[0].token_name }
                    });
                } else {
                    results.failed++;
                    results.errors.push(`Failed: ${subscriber.email}`);
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (err) {
                results.failed++;
                results.errors.push(`Error for ${subscriber.email}: ${err.message}`);
                console.error(`Error sending to ${subscriber.email}:`, err);
            }
        }

        // Update token last used
        await supabase
            .from('access_tokens')
            .update({ last_used: new Date().toISOString() })
            .eq('id', tokens[0].id);

        // Calculate duration
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Send summary to admin
        const summaryMsg = `
✅ <b>Daily Token Delivery Complete</b>

📤 <b>Sent:</b> ${results.success}
❌ <b>Failed:</b> ${results.failed}
⏱️ <b>Duration:</b> ${duration}s
📅 <b>Date:</b> ${new Date().toLocaleDateString('en-IN')}

${results.errors.length > 0 ? `\n<b>Errors:</b>\n${results.errors.slice(0, 5).join('\n')}${results.errors.length > 5 ? `\n...and ${results.errors.length - 5} more` : ''}` : ''}
        `.trim();

        await notifyAdmin(summaryMsg);

        console.log('Token delivery complete:', results);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                results,
                duration: `${duration}s`,
                timestamp: new Date().toISOString()
            })
        };

    } catch (err) {
        console.error('Cron job error:', err);

        await notifyAdmin(`❌ <b>Cron Job Failed!</b>\n\nError: ${err.message}`);

        return {
            statusCode: 200, // Return 200 to prevent retries
            body: JSON.stringify({
                success: false,
                error: err.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};
