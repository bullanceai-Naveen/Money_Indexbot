const { Resend } = require('resend');
const { getSupabaseAdmin } = require('./_shared/supabase');
const { extractUserId } = require('./_shared/auth');
const { validateContactForm } = require('./_shared/validation');
const { handleCORS, success, error, validationError, methodNotAllowed, serverError, parseBody, getClientIP } = require('./_shared/response');
const { rateLimitMiddleware } = require('./_shared/rate-limiter');

// Initialize Resend
let resend = null;
function getResend() {
    if (!resend && process.env.RESEND_API_KEY) {
        resend = new Resend(process.env.RESEND_API_KEY);
    }
    return resend;
}

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(['POST']);
    }

    // Strict rate limiting for contact form
    const rateLimited = rateLimitMiddleware(event, 'contact');
    if (rateLimited) return rateLimited;

    try {
        // Parse body
        const { data: body, error: parseError } = parseBody(event);
        if (parseError) return error(parseError);

        // Validate input
        const validation = validateContactForm(body);
        if (!validation.valid) {
            return validationError(validation.errors);
        }

        const { name, email, subject, message } = validation.sanitized;

        const supabase = getSupabaseAdmin();

        // Get user ID if authenticated (optional)
        const userId = extractUserId(event);

        // Store message in database
        const { error: insertError } = await supabase.from('contact_messages').insert({
            user_id: userId,
            name,
            email,
            subject,
            message,
            status: 'new'
        });

        if (insertError) {
            console.error('Failed to store message:', insertError);
            // Continue anyway - try to send email
        }

        // Send email to admin
        const resendClient = getResend();

        if (resendClient) {
            try {
                // Send notification to admin
                await resendClient.emails.send({
                    from: process.env.FROM_EMAIL || 'MoneyIndex <noreply@moneyindex.app>',
                    to: [process.env.ADMIN_EMAIL || 'hello@bullance.in'],
                    subject: `[Contact Form] ${subject}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #333; border-bottom: 2px solid #6366f1; padding-bottom: 10px;">
                                New Contact Form Submission
                            </h2>

                            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                                <tr>
                                    <td style="padding: 10px; background: #f3f4f6; font-weight: bold; width: 100px;">From:</td>
                                    <td style="padding: 10px; background: #f9fafb;">${name}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Email:</td>
                                    <td style="padding: 10px; background: #f9fafb;">
                                        <a href="mailto:${email}">${email}</a>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">Subject:</td>
                                    <td style="padding: 10px; background: #f9fafb;">${subject}</td>
                                </tr>
                                ${userId ? `
                                <tr>
                                    <td style="padding: 10px; background: #f3f4f6; font-weight: bold;">User ID:</td>
                                    <td style="padding: 10px; background: #f9fafb; font-family: monospace; font-size: 12px;">${userId}</td>
                                </tr>
                                ` : ''}
                            </table>

                            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="margin-top: 0; color: #333;">Message:</h3>
                                <p style="white-space: pre-wrap; line-height: 1.6;">${message}</p>
                            </div>

                            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

                            <p style="color: #6b7280; font-size: 12px;">
                                Sent from MoneyIndex Contact Form<br>
                                IP: ${getClientIP(event)}<br>
                                Time: ${new Date().toISOString()}
                            </p>
                        </div>
                    `
                });

                // Send confirmation to user
                await resendClient.emails.send({
                    from: process.env.FROM_EMAIL || 'MoneyIndex <noreply@moneyindex.app>',
                    to: [email],
                    subject: 'We received your message - MoneyIndex',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #333;">Thank you for contacting us!</h2>

                            <p>Hi ${name},</p>

                            <p>We've received your message and will get back to you as soon as possible, usually within 24 hours.</p>

                            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <strong>Your message:</strong>
                                <p style="white-space: pre-wrap;">${message}</p>
                            </div>

                            <p>If you have any urgent queries, you can also reach us at <a href="mailto:hello@bullance.in">hello@bullance.in</a></p>

                            <p style="margin-top: 30px;">
                                Best regards,<br>
                                <strong>The MoneyIndex Team</strong>
                            </p>
                        </div>
                    `
                });

            } catch (emailError) {
                console.error('Email sending failed:', emailError);
                // Don't fail the request - message is stored in database
            }
        } else {
            console.warn('Resend not configured - email not sent');
        }

        return success({
            message: 'Thank you! Your message has been sent successfully. We\'ll get back to you soon.'
        });

    } catch (err) {
        console.error('Contact form error:', err);
        return serverError('Failed to send message. Please try again or email us directly at hello@bullance.in');
    }
};
