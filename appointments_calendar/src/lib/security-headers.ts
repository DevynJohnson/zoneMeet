/**
 * Security headers using Next.js middleware
 * Based on Helmet.js best practices but adapted for Next.js
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Generate a cryptographically secure nonce for CSP (Edge Runtime compatible)
 */
export function generateNonce(): string {
  // Use crypto.getRandomValues for Edge Runtime compatibility
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/[+/]/g, '').substring(0, 16);
}

/**
 * Generate CSRF token (Edge Runtime compatible)
 */
export function generateCSRFToken(): string {
  // Use crypto.getRandomValues for Edge Runtime compatibility
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate CSRF token
 */
export function validateCSRFToken(token: string, sessionToken: string): boolean {
  if (!token || !sessionToken) return false;
  return token === sessionToken;
}

/**
 * Add security headers to response
 */
export function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking attacks
  response.headers.set('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection in browsers
  response.headers.set('X-XSS-Protection', '1; mode=block');
  
  // Control referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Prevent DNS prefetching
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  
  // Disable Adobe Flash and PDF files from loading
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  
  // Force HTTPS (only in production)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  // Enhanced Content Security Policy - OAuth-compatible for calendar integrations
  const cspDirectives = [
    "default-src 'self'",
    // Script sources - allow OAuth provider scripts and Next.js
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com https://www.gstatic.com https://ssl.gstatic.com https://login.microsoftonline.com https://graph.microsoft.com https://appleid.apple.com https: data: blob:",
    // Style sources - allow OAuth provider styles
    "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com https://login.microsoftonline.com https://appleid.apple.com https: data:",
    // Font sources
    "font-src 'self' https://fonts.gstatic.com https://accounts.google.com https: data:",
    // Image sources - allow OAuth provider assets
    "img-src 'self' data: https: blob:",
    // Connect sources - OAuth token endpoints and API calls
    "connect-src 'self' https://oauth2.googleapis.com https://www.googleapis.com https://accounts.google.com https://login.microsoftonline.com https://graph.microsoft.com https://appleid.apple.com https://caldav.icloud.com https://*.ingest.sentry.io https://*.sentry.io https: wss: data:",
    // Media sources
    "media-src 'self' https: data:",
    // Object sources - allow for OAuth compatibility
    "object-src 'self'",
    // Base URI restriction
    "base-uri 'self'",
    // Form action - allow OAuth redirects
    "form-action 'self' https://accounts.google.com https://login.microsoftonline.com https://appleid.apple.com https:",
    // Frame ancestors - allow OAuth popups to embed
    "frame-ancestors 'self' https://accounts.google.com https://login.microsoftonline.com https://appleid.apple.com",
    // Frame sources - OAuth popup windows and widgets
    "frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://appleid.apple.com https://www.google.com https: data:",
    // Worker sources
    "worker-src 'self' blob: data:",
    // Manifest sources
    "manifest-src 'self'"
  ];
  
  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));
  
  // Additional security headers
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=()');
  
  // Expect-CT header for certificate transparency
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Expect-CT', 'enforce, max-age=86400');
  }
  
  // Remove server fingerprinting
  response.headers.delete('Server');
  response.headers.delete('X-Powered-By');
  
  return response;
}

/**
 * CORS configuration for API routes
 */
export function addCORSHeaders(response: NextResponse, origin?: string): NextResponse {
  // Allow specific origins in production, localhost in development
  const allowedOrigins = process.env.NODE_ENV === 'production' 
    ? (process.env.ALLOWED_ORIGINS?.split(',') || [])
    : ['http://localhost:3000', 'https://localhost:3000'];
  
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV === 'development') {
    response.headers.set('Access-Control-Allow-Origin', '*');
  }
  
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours
  
  return response;
}

/**
 * Security middleware for Next.js
 */
export function securityMiddleware(request: NextRequest) {
  const response = NextResponse.next();
  const origin = request.headers.get('origin');
  
  // Generate nonce for CSP
  const nonce = generateNonce();
  
  // Add nonce to response headers for use in HTML
  response.headers.set('x-nonce', nonce);
  
  // Add security headers with relaxed CSP
  const secureResponse = addSecurityHeaders(response);
  
  // Add CORS headers for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    addCORSHeaders(secureResponse, origin || undefined);
    
    // Add CSRF protection for state-changing operations (excluding auth endpoints)
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      const csrfToken = request.headers.get('x-csrf-token');
      const sessionToken = request.cookies.get('csrf-token')?.value;
      
      // Skip CSRF validation for authentication endpoints
      const authEndpoints = [
        '/api/auth/login',
        '/api/auth/register', 
        '/api/auth/csrf',
        '/api/provider/auth/login',
        '/api/provider/auth/register',
        '/api/login',
        '/api/register',
        '/api/oauth',
        '/api/callback',
        '/api/provider/calendar/connect',
        '/api/provider/calendar/callback'
      ];
      
      const isAuthEndpoint = authEndpoints.some(endpoint => 
        request.nextUrl.pathname === endpoint || request.nextUrl.pathname.startsWith(endpoint)
      );
      
      if (!isAuthEndpoint && !validateCSRFToken(csrfToken || '', sessionToken || '')) {
        return new NextResponse(
          JSON.stringify({
            error: 'CSRF token validation failed',
            message: 'Invalid or missing CSRF token'
          }),
          { 
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }
  }
  
  return secureResponse;
}

/**
 * Rate limiting response headers
 */
export function addRateLimitHeaders(
  response: NextResponse, 
  limit: number, 
  remaining: number, 
  reset: Date
): NextResponse {
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', reset.toISOString());
  
  return response;
}
