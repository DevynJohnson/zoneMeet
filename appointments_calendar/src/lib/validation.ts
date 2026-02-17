/**
 * Professional input validation using Zod with enhanced security features
 * Includes XSS protection, SQL injection prevention, and comprehensive sanitization
 */

import { z } from 'zod';

/**
 * Sanitize HTML content to prevent XSS attacks (Edge Runtime compatible)
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== 'string') return '';
  
  // Use basic sanitization for Edge Runtime compatibility
  // Remove potentially dangerous HTML tags and scripts
  const sanitized = input
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocols
    .replace(/vbscript:/gi, '') // Remove vbscript: protocols
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
  
  return sanitized;
}

/**
 * Enhanced text transformation with XSS protection
 */
const sanitizedTextTransform = (text: string) => {
  const trimmed = text.trim();
  const sanitized = sanitizeHtml(trimmed);
  
  // Additional security checks
  if (sanitized !== trimmed) {
    throw new Error('Input contains potentially malicious content');
  }
  
  return sanitized;
};

// Password validation schema with all security requirements
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must be no more than 128 characters long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/, 'Password must contain at least one special character')
  .refine((password) => {
    // Check for common weak passwords
    const commonPasswords = [
      'password', 'password123', '123456', '123456789', 'qwerty', 'abc123',
      'password1', 'admin', 'letmein', 'welcome', 'monkey', '1234567890'
    ];
    return !commonPasswords.includes(password.toLowerCase());
  }, 'Password is too common and easily guessable');

// Email validation schema with XSS protection
export const emailSchema = z
  .string()
  .email('Please provide a valid email address')
  .max(254, 'Email address is too long')
  .transform(email => sanitizeHtml(email.toLowerCase().trim()));

// Phone validation schema with sanitization
export const phoneSchema = z
  .string()
  .refine((phone) => {
    // Allow empty string (will be handled as optional in schemas)
    if (!phone || phone.trim() === '') return true;
    // Remove all non-digits for validation
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 7 && digitsOnly.length <= 15;
  }, 'Phone number must be between 7-15 digits')
  .refine((phone) => {
    // Allow empty string
    if (!phone || phone.trim() === '') return true;
    // Check for valid characters
    return /^[\d\s\-\(\)\+\.]+$/.test(phone);
  }, 'Phone number contains invalid characters')
  .transform(phone => phone ? sanitizeHtml(phone).replace(/\D/g, '') : ''); // Remove non-digits, return empty string if empty

// Text field validation with XSS protection (for names, company, etc.)
export const textFieldSchema = z
  .string()
  .min(1, 'This field is required')
  .max(255, 'Text is too long')
  .transform(sanitizedTextTransform)
  .refine(text => text.length > 0, 'Field cannot be empty after trimming');

// Bio/description validation with XSS protection
export const bioSchema = z
  .string()
  .max(1000, 'Bio must be no more than 1000 characters')
  .optional()
  .transform(bio => bio ? sanitizedTextTransform(bio) : undefined);

// Provider registration validation schema
export const providerRegistrationSchema = z.object({
  name: textFieldSchema,
  email: emailSchema,
  phone: z.string().transform(val => val.trim() === '' ? undefined : val).pipe(phoneSchema.optional()),
  password: passwordSchema,
  confirmPassword: z.string().optional(), // Validated separately in frontend
  company: textFieldSchema.optional(),
  title: textFieldSchema.optional(),
  bio: bioSchema,
});

// Provider login validation schema
export const providerLoginSchema = z.object({
  email: emailSchema,
  password: z.string().trim().min(1, 'Password is required'),
});

// Calendar connection validation schema
export const calendarConnectionSchema = z.object({
  provider: z.enum(['google', 'outlook', 'teams', 'apple']),
  accessToken: z.string().min(1, 'Access token is required'),
  refreshToken: z.string().optional(),
  expiresAt: z.date().optional(),
  calendarId: z.string().optional(),
  calendarName: z.string().optional(),
  isDefaultForBookings: z.boolean().default(false),
  syncEvents: z.boolean().default(true),
  allowBookings: z.boolean().default(true),
});

// Appointment booking validation schema with enhanced security
export const appointmentBookingSchema = z.object({
  clientName: textFieldSchema,
  clientEmail: emailSchema,
  clientPhone: phoneSchema.optional(),
  startTime: z.date(),
  endTime: z.date(),
  title: textFieldSchema,
  description: z.string().max(500, 'Description is too long').optional()
    .transform(desc => desc ? sanitizedTextTransform(desc) : undefined),
  location: z.string().max(200, 'Location is too long').optional()
    .transform(loc => loc ? sanitizedTextTransform(loc) : undefined),
}).refine(data => data.endTime > data.startTime, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

// UUID validation schema for secure ID handling
export const uuidSchema = z
  .string()
  .uuid('Invalid ID format')
  .transform(sanitizeHtml);

// URL validation schema with security checks
export const urlSchema = z
  .string()
  .url('Invalid URL format')
  .refine((url) => {
    // Only allow HTTP/HTTPS protocols
    return url.startsWith('https://') || url.startsWith('http://');
  }, 'Only HTTP/HTTPS URLs are allowed')
  .transform(sanitizeHtml);

// Database query parameter validation to prevent SQL injection
export const dbQueryParamSchema = z
  .string()
  .refine((param) => {
    // Check for SQL injection patterns
    const sqlInjectionPatterns = [
      /['";]/,  // Quote characters
      /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/i,
      /(--|\*\/|\/\*)/,  // SQL comments
      /(\bor\b.*\b=\b|\band\b.*\b=\b)/i,  // Common injection patterns
    ];
    
    return !sqlInjectionPatterns.some(pattern => pattern.test(param));
  }, 'Parameter contains potentially malicious content')
  .transform(sanitizeHtml);

// File upload validation
export const fileUploadSchema = z.object({
  filename: z.string()
    .min(1, 'Filename is required')
    .max(255, 'Filename is too long')
    .refine((filename) => {
      // Only allow safe characters in filenames
      return /^[a-zA-Z0-9._-]+$/.test(filename);
    }, 'Filename contains invalid characters')
    .refine((filename) => {
      // Check for directory traversal attempts
      return !filename.includes('..') && !filename.includes('/') && !filename.includes('\\');
    }, 'Filename contains path traversal characters'),
  mimetype: z.string()
    .refine((type) => {
      // Only allow specific MIME types
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
      ];
      return allowedTypes.includes(type);
    }, 'File type not allowed'),
  size: z.number()
    .min(1, 'File cannot be empty')
    .max(10 * 1024 * 1024, 'File size cannot exceed 10MB'), // 10MB limit
});

/**
 * Validate request body against schema
 */
export async function validateRequestBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; errors: string[] }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errors = result.error.issues.map(issue => 
        `${issue.path.join('.')}: ${issue.message}`
      );
      return { success: false, errors };
    }
  } catch {
    return { success: false, errors: ['Invalid JSON format'] };
  }
}

/**
 * Create validation error response with security logging
 */
export function createValidationErrorResponse(errors: string[], request?: Request) {
  // Log validation failures for security monitoring
  if (request) {
    const clientIP = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    
    console.warn('Validation failure detected:', {
      timestamp: new Date().toISOString(),
      ip: clientIP,
      userAgent,
      url: request.url,
      errors,
    });
    
    // Check for potential security threats
    const suspiciousPatterns = [
      'script',
      'javascript',
      'vbscript',
      'onload',
      'onerror',
      'union',
      'select',
      'insert',
      'update',
      'delete',
      'drop',
    ];
    
    const hasSuspiciousContent = errors.some(error => 
      suspiciousPatterns.some(pattern => 
        error.toLowerCase().includes(pattern)
      )
    );
    
    if (hasSuspiciousContent) {
      console.error('SECURITY ALERT: Suspicious validation failure detected:', {
        timestamp: new Date().toISOString(),
        ip: clientIP,
        userAgent,
        url: request.url,
        errors,
        severity: 'HIGH',
      });
    }
  }
  
  return new Response(
    JSON.stringify({
      error: 'Validation failed',
      details: errors
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Security headers validation middleware
 */
export function validateSecurityHeaders(request: Request): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check for required security headers in POST/PUT/DELETE requests
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const contentType = request.headers.get('content-type');
    
    // More lenient Content-Type check - allow if it starts with application/json
    if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
      errors.push('Invalid Content-Type header');
    }
    // Don't require Content-Type for requests without body (like some DELETE requests)
    
    const csrfToken = request.headers.get('x-csrf-token') || request.headers.get('X-CSRF-Token');
    if (!csrfToken) {
      errors.push('Missing CSRF token');
    } else if (csrfToken.length < 32) {
      // Basic validation - CSRF tokens should be at least 32 characters
      errors.push('Invalid CSRF token format');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Request rate limiting check
 */
export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
  skipSuccessfulRequests?: boolean;
}

const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  clientId: string, 
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  
  // Clean up old entries
  for (const [key, value] of requestCounts.entries()) {
    if (value.resetTime < now) {
      requestCounts.delete(key);
    }
  }
  
  const current = requestCounts.get(clientId);
  
  if (!current || current.resetTime < now) {
    // First request in window or window expired
    requestCounts.set(clientId, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
    };
  }
  
  if (current.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: current.resetTime,
    };
  }
  
  current.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - current.count,
    resetTime: current.resetTime,
  };
}

/**
 * Password strength meter for frontend
 */
export function getPasswordStrength(password: string) {
  const requirements = [
    { test: password.length >= 8, label: 'At least 8 characters' },
    { test: /[A-Z]/.test(password), label: 'One uppercase letter' },
    { test: /[a-z]/.test(password), label: 'One lowercase letter' },
    { test: /[0-9]/.test(password), label: 'One number' },
    { test: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password), label: 'One special character' },
  ];

  const score = requirements.filter(req => req.test).length;
  const percentage = (score / requirements.length) * 100;

  let color = 'bg-red-500';
  let label = 'Weak';
  
  if (percentage >= 80) {
    color = 'bg-green-500';
    label = 'Strong';
  } else if (percentage >= 60) {
    color = 'bg-yellow-500';
    label = 'Medium';
  }

  // Get validation errors
  const validation = passwordSchema.safeParse(password);
  const errors = validation.success ? [] : validation.error.issues.map(issue => issue.message);

  return {
    score,
    percentage,
    color,
    label,
    requirements,
    errors
  };
}
