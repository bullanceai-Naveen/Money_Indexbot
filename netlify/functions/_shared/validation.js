/**
 * Input validation utilities
 * Prevents injection attacks and ensures data integrity
 */

/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim()) && email.length <= 254;
}

/**
 * Validate password strength
 * Requirements: min 8 chars, at least one uppercase, one lowercase, one number
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
    if (!password || typeof password !== 'string') return false;
    if (password.length < 8 || password.length > 128) return false;

    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    return hasUppercase && hasLowercase && hasNumber;
}

/**
 * Validate Indian phone number
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
    if (!phone) return true; // Phone is optional
    if (typeof phone !== 'string') return false;
    const phoneRegex = /^[6-9]\d{9}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
}

/**
 * Validate name (2-100 chars, letters and spaces only)
 * @param {string} name
 * @returns {boolean}
 */
function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) return false;
    // Allow letters, spaces, and common name characters
    const nameRegex = /^[a-zA-Z\s\-'.]+$/;
    return nameRegex.test(trimmed);
}

/**
 * Validate Telegram chat ID
 * @param {string} chatId
 * @returns {boolean}
 */
function isValidTelegramChatId(chatId) {
    if (!chatId) return true; // Optional
    if (typeof chatId !== 'string') return false;
    // Chat IDs are numeric (can be negative for groups)
    const chatIdRegex = /^-?\d+$/;
    return chatIdRegex.test(chatId.trim());
}

/**
 * Sanitize string input (remove potential XSS)
 * @param {string} input
 * @returns {string}
 */
function sanitizeString(input) {
    if (!input || typeof input !== 'string') return '';
    return input
        .trim()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * Validate and sanitize contact form data
 * @param {Object} data - { name, email, subject, message }
 * @returns {Object} { valid: boolean, errors: string[], sanitized: Object }
 */
function validateContactForm(data) {
    const errors = [];
    const sanitized = {};

    // Name validation
    if (!data.name || !isValidName(data.name)) {
        errors.push('Valid name is required (2-100 characters)');
    } else {
        sanitized.name = sanitizeString(data.name);
    }

    // Email validation
    if (!data.email || !isValidEmail(data.email)) {
        errors.push('Valid email address is required');
    } else {
        sanitized.email = data.email.trim().toLowerCase();
    }

    // Subject (optional)
    if (data.subject) {
        if (typeof data.subject !== 'string' || data.subject.length > 200) {
            errors.push('Subject must be under 200 characters');
        } else {
            sanitized.subject = sanitizeString(data.subject);
        }
    } else {
        sanitized.subject = 'No Subject';
    }

    // Message validation
    if (!data.message || typeof data.message !== 'string') {
        errors.push('Message is required');
    } else if (data.message.trim().length < 10) {
        errors.push('Message must be at least 10 characters');
    } else if (data.message.length > 5000) {
        errors.push('Message must be under 5000 characters');
    } else {
        sanitized.message = sanitizeString(data.message);
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
}

/**
 * Validate registration data
 * @param {Object} data - { email, password, full_name, phone }
 * @returns {Object} { valid: boolean, errors: string[], sanitized: Object }
 */
function validateRegistration(data) {
    const errors = [];
    const sanitized = {};

    // Email
    if (!data.email || !isValidEmail(data.email)) {
        errors.push('Valid email address is required');
    } else {
        sanitized.email = data.email.trim().toLowerCase();
    }

    // Password
    if (!data.password) {
        errors.push('Password is required');
    } else if (!isValidPassword(data.password)) {
        errors.push('Password must be at least 8 characters with uppercase, lowercase, and number');
    }

    // Full name (optional but validated if provided)
    if (data.full_name) {
        if (!isValidName(data.full_name)) {
            errors.push('Name must be 2-100 characters, letters only');
        } else {
            sanitized.full_name = sanitizeString(data.full_name);
        }
    }

    // Phone (optional)
    if (data.phone) {
        if (!isValidPhone(data.phone)) {
            errors.push('Invalid phone number format');
        } else {
            sanitized.phone = data.phone.replace(/\s/g, '');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
}

/**
 * Validate profile update data
 * @param {Object} data - { full_name, phone, telegram_chat_id }
 * @returns {Object} { valid: boolean, errors: string[], sanitized: Object }
 */
function validateProfileUpdate(data) {
    const errors = [];
    const sanitized = {};

    // Full name
    if (data.full_name !== undefined) {
        if (data.full_name && !isValidName(data.full_name)) {
            errors.push('Name must be 2-100 characters, letters only');
        } else {
            sanitized.full_name = data.full_name ? sanitizeString(data.full_name) : null;
        }
    }

    // Phone
    if (data.phone !== undefined) {
        if (data.phone && !isValidPhone(data.phone)) {
            errors.push('Invalid phone number format');
        } else {
            sanitized.phone = data.phone ? data.phone.replace(/\s/g, '') : null;
        }
    }

    // Telegram chat ID
    if (data.telegram_chat_id !== undefined) {
        if (data.telegram_chat_id && !isValidTelegramChatId(data.telegram_chat_id)) {
            errors.push('Invalid Telegram chat ID');
        } else {
            sanitized.telegram_chat_id = data.telegram_chat_id ? data.telegram_chat_id.trim() : null;
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
}

module.exports = {
    isValidEmail,
    isValidPassword,
    isValidPhone,
    isValidName,
    isValidTelegramChatId,
    sanitizeString,
    validateContactForm,
    validateRegistration,
    validateProfileUpdate
};
