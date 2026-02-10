/**
 * Standardized HTTP response utilities for Netlify Functions
 * Ensures consistent response format and security headers
 */

// CORS and security headers
const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
};

/**
 * Handle CORS preflight requests
 * @param {Object} event - Netlify function event
 * @returns {Object|null} Response for OPTIONS request, or null to continue
 */
function handleCORS(event) {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: defaultHeaders,
            body: ''
        };
    }
    return null;
}

/**
 * Success response (200)
 * @param {Object} data - Response data
 * @param {number} statusCode - HTTP status code (default 200)
 * @returns {Object} Netlify function response
 */
function success(data, statusCode = 200) {
    return {
        statusCode,
        headers: defaultHeaders,
        body: JSON.stringify(data)
    };
}

/**
 * Created response (201)
 * @param {Object} data - Response data
 * @returns {Object} Netlify function response
 */
function created(data) {
    return success(data, 201);
}

/**
 * Error response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default 400)
 * @returns {Object} Netlify function response
 */
function error(message, statusCode = 400) {
    return {
        statusCode,
        headers: defaultHeaders,
        body: JSON.stringify({ error: message })
    };
}

/**
 * Validation error response (400)
 * @param {string|string[]} errors - Error message(s)
 * @returns {Object} Netlify function response
 */
function validationError(errors) {
    const errorList = Array.isArray(errors) ? errors : [errors];
    return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({
            error: 'Validation failed',
            details: errorList
        })
    };
}

/**
 * Unauthorized response (401)
 * @param {string} message - Error message
 * @returns {Object} Netlify function response
 */
function unauthorized(message = 'Authentication required') {
    return error(message, 401);
}

/**
 * Forbidden response (403)
 * @param {string} message - Error message
 * @returns {Object} Netlify function response
 */
function forbidden(message = 'Access denied') {
    return error(message, 403);
}

/**
 * Not found response (404)
 * @param {string} message - Error message
 * @returns {Object} Netlify function response
 */
function notFound(message = 'Resource not found') {
    return error(message, 404);
}

/**
 * Method not allowed response (405)
 * @param {string[]} allowedMethods - List of allowed methods
 * @returns {Object} Netlify function response
 */
function methodNotAllowed(allowedMethods = ['GET', 'POST']) {
    return {
        statusCode: 405,
        headers: {
            ...defaultHeaders,
            'Allow': allowedMethods.join(', ')
        },
        body: JSON.stringify({
            error: 'Method not allowed',
            allowed: allowedMethods
        })
    };
}

/**
 * Rate limit exceeded response (429)
 * @param {number} retryAfter - Seconds until retry is allowed
 * @returns {Object} Netlify function response
 */
function rateLimited(retryAfter = 60) {
    return {
        statusCode: 429,
        headers: {
            ...defaultHeaders,
            'Retry-After': String(retryAfter)
        },
        body: JSON.stringify({
            error: 'Too many requests. Please try again later.',
            retryAfter
        })
    };
}

/**
 * Internal server error response (500)
 * @param {string} message - Error message (generic for security)
 * @returns {Object} Netlify function response
 */
function serverError(message = 'An unexpected error occurred') {
    return error(message, 500);
}

/**
 * Service unavailable response (503)
 * @param {string} message - Error message
 * @returns {Object} Netlify function response
 */
function serviceUnavailable(message = 'Service temporarily unavailable') {
    return error(message, 503);
}

/**
 * Parse JSON body safely
 * @param {Object} event - Netlify function event
 * @returns {Object} { data: Object|null, error: string|null }
 */
function parseBody(event) {
    if (!event.body) {
        return { data: null, error: 'Request body is required' };
    }

    try {
        const data = JSON.parse(event.body);
        return { data, error: null };
    } catch (err) {
        return { data: null, error: 'Invalid JSON in request body' };
    }
}

/**
 * Get client IP address from request
 * @param {Object} event - Netlify function event
 * @returns {string} IP address
 */
function getClientIP(event) {
    return event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           event.headers['x-real-ip'] ||
           event.headers['client-ip'] ||
           'unknown';
}

module.exports = {
    defaultHeaders,
    handleCORS,
    success,
    created,
    error,
    validationError,
    unauthorized,
    forbidden,
    notFound,
    methodNotAllowed,
    rateLimited,
    serverError,
    serviceUnavailable,
    parseBody,
    getClientIP
};
