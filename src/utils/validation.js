/**
 * Input validation and sanitization utilities
 */

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone validation regex (international format)
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

// Password requirements
const PASSWORD_MIN_LENGTH = 8;

/**
 * Validate email format
 */
export const isValidEmail = (email) => {
  return typeof email === "string" && EMAIL_REGEX.test(email.trim());
};

/**
 * Validate phone format
 */
export const isValidPhone = (phone) => {
  if (typeof phone !== "string") return false;
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  return PHONE_REGEX.test(cleaned);
};

/**
 * Validate password strength
 */
export const isValidPassword = (password) => {
  if (typeof password !== "string") return { valid: false, error: "Password is required" };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must contain a lowercase letter" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must contain an uppercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain a number" };
  }
  return { valid: true };
};

/**
 * Sanitize string input - prevent XSS
 */
export const sanitizeString = (str) => {
  if (typeof str !== "string") return "";
  return str
    .trim()
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
};

/**
 * Sanitize and validate UUID
 */
export const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof uuid === "string" && uuidRegex.test(uuid);
};

/**
 * Validate date string (ISO format)
 */
export const isValidDate = (dateStr) => {
  if (typeof dateStr !== "string") return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
};

/**
 * Validate future date
 */
export const isFutureDate = (dateStr) => {
  if (!isValidDate(dateStr)) return false;
  return new Date(dateStr) > new Date();
};

/**
 * Validate numeric ID
 */
export const isValidId = (id) => {
  const num = Number(id);
  return Number.isInteger(num) && num > 0;
};

/**
 * Validation middleware factory
 */
export const validate = (schema) => {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (rules.required && (value === undefined || value === null || value === "")) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value !== undefined && value !== null && value !== "") {
        if (rules.type === "email" && !isValidEmail(value)) {
          errors.push(`${field} must be a valid email`);
        }
        if (rules.type === "phone" && !isValidPhone(value)) {
          errors.push(`${field} must be a valid phone number`);
        }
        if (rules.type === "password") {
          const result = isValidPassword(value);
          if (!result.valid) errors.push(result.error);
        }
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must not exceed ${rules.maxLength} characters`);
        }
        if (rules.min !== undefined && Number(value) < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && Number(value) > rules.max) {
          errors.push(`${field} must not exceed ${rules.max}`);
        }
        if (rules.enum && !rules.enum.includes(value)) {
          errors.push(`${field} must be one of: ${rules.enum.join(", ")}`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    next();
  };
};
