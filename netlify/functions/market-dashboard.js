const { getSupabaseAdmin } = require('./_shared/supabase');
const { verifySubscription } = require('./_shared/auth');
const { decrypt } = require('./_shared/encryption');
const { handleCORS, success, error, unauthorized, forbidden, methodNotAllowed, serverError, serviceUnavailable, getClientIP } = require('./_shared/response');
const { rateLimitMiddleware } = require('./_shared/rate-limiter');

// Supported indices
const SUPPORTED_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'CRUDEOIL', 'NATURALGAS'];

// Cache for market data (1 minute TTL)
let marketDataCache = {
    data: null,
    timestamp: 0,
    TTL: 60000 // 1 minute
};

/**
 * Fetch market data from Upstox API
 */
async function fetchMarketData(token) {
    const baseUrl = 'https://api.upstox.com/v2';

    // Map index names to Upstox instrument keys
    const instrumentKeys = {
        'NIFTY': 'NSE_INDEX|Nifty 50',
        'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
        'FINNIFTY': 'NSE_INDEX|Nifty Fin Service',
        'SENSEX': 'BSE_INDEX|SENSEX',
        'CRUDEOIL': 'MCX_INDEX|CRUDEOIL',
        'NATURALGAS': 'MCX_INDEX|NATURALGAS'
    };

    const results = {};

    try {
        // Fetch quotes for all indices
        const keys = Object.values(instrumentKeys).map(encodeURIComponent).join(',');

        const response = await fetch(`${baseUrl}/market-quote/quotes?instrument_key=${keys}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Upstox API error:', response.status);
            return null;
        }

        const data = await response.json();

        if (data.status !== 'success' || !data.data) {
            return null;
        }

        // Process each index
        for (const [indexName, instrumentKey] of Object.entries(instrumentKeys)) {
            const quote = data.data[instrumentKey];

            if (quote) {
                results[indexName] = {
                    spot_price: quote.last_price || 0,
                    change: quote.net_change || 0,
                    change_percent: quote.percentage_change || 0,
                    open: quote.ohlc?.open || 0,
                    high: quote.ohlc?.high || 0,
                    low: quote.ohlc?.low || 0,
                    close: quote.ohlc?.close || 0,
                    last_update: new Date().toISOString()
                };
            } else {
                results[indexName] = {
                    spot_price: 0,
                    change: 0,
                    change_percent: 0,
                    last_update: null,
                    error: 'Data unavailable'
                };
            }
        }

        return results;

    } catch (err) {
        console.error('Market data fetch error:', err);
        return null;
    }
}

exports.handler = async (event) => {
    // Handle CORS preflight
    const cors = handleCORS(event);
    if (cors) return cors;

    // Only allow GET
    if (event.httpMethod !== 'GET') {
        return methodNotAllowed(['GET']);
    }

    // Rate limiting
    const rateLimited = rateLimitMiddleware(event, 'api');
    if (rateLimited) return rateLimited;

    try {
        // Verify subscription
        const { user, profile, error: authError } = await verifySubscription(event);

        if (authError) {
            if (authError.includes('Subscription')) {
                return forbidden(authError);
            }
            return unauthorized(authError);
        }

        const supabase = getSupabaseAdmin();

        // Check cache first
        const now = Date.now();
        if (marketDataCache.data && (now - marketDataCache.timestamp) < marketDataCache.TTL) {
            // Log activity (async, don't wait)
            supabase.from('user_activity').insert({
                user_id: user.id,
                action: 'view_dashboard',
                metadata: { cached: true },
                ip_address: getClientIP(event)
            }).then(() => {}).catch(() => {});

            return success({
                data: marketDataCache.data,
                cached: true,
                cache_age: Math.round((now - marketDataCache.timestamp) / 1000)
            });
        }

        // Get active Upstox token
        const { data: tokens, error: tokenError } = await supabase
            .from('access_tokens')
            .select('token_encrypted')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1);

        if (tokenError || !tokens || tokens.length === 0) {
            console.error('No active token found');
            return serviceUnavailable('Market data service temporarily unavailable. Please try again later.');
        }

        // Decrypt token
        let upstoxToken;
        try {
            upstoxToken = decrypt(tokens[0].token_encrypted);
        } catch (decryptError) {
            console.error('Token decryption failed:', decryptError);
            return serviceUnavailable('Market data service configuration error.');
        }

        // Fetch market data
        const marketData = await fetchMarketData(upstoxToken);

        if (!marketData) {
            // Try to return cached data even if stale
            if (marketDataCache.data) {
                return success({
                    data: marketDataCache.data,
                    cached: true,
                    stale: true,
                    cache_age: Math.round((now - marketDataCache.timestamp) / 1000)
                });
            }

            return serviceUnavailable('Unable to fetch market data. Please try again.');
        }

        // Update cache
        marketDataCache = {
            data: marketData,
            timestamp: now,
            TTL: 60000
        };

        // Update token last used
        supabase
            .from('access_tokens')
            .update({ last_used: new Date().toISOString() })
            .eq('token_encrypted', tokens[0].token_encrypted)
            .then(() => {}).catch(() => {});

        // Log activity
        supabase.from('user_activity').insert({
            user_id: user.id,
            action: 'view_dashboard',
            metadata: { cached: false },
            ip_address: getClientIP(event)
        }).then(() => {}).catch(() => {});

        return success({
            data: marketData,
            cached: false,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Dashboard error:', err);
        return serverError('Failed to fetch market data. Please try again.');
    }
};
