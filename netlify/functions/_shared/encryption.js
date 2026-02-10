const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted string in format: iv:authTag:encryptedData (hex)
 */
function encrypt(text) {
    if (!process.env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY environment variable not set');
    }

    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

    if (key.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt data encrypted with encrypt()
 * @param {string} encryptedText - Encrypted string in format: iv:authTag:encryptedData
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedText) {
    if (!process.env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY environment variable not set');
    }

    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

    if (key.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
    }

    const parts = encryptedText.split(':');

    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, encrypted] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Generate a secure random encryption key
 * @returns {string} 32-byte key as hex string (64 characters)
 */
function generateKey() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a string using SHA-256 (one-way, for comparisons)
 * @param {string} text - Text to hash
 * @returns {string} Hex hash
 */
function hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Generate a secure random token
 * @param {number} length - Number of bytes (default 32)
 * @returns {string} Random token as hex string
 */
function generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

module.exports = {
    encrypt,
    decrypt,
    generateKey,
    hash,
    generateToken
};
