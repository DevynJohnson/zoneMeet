import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, validateSecurityHeaders } from '@/lib/validation';
import { logSuspiciousActivity, checkIPBlocking, trackRequest } from '@/lib/security-monitor';

export interface WAFConfig {
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  ipWhitelist?: string[];
  ipBlacklist?: string[];
  blockSuspiciousPatterns: boolean;
  blockBasicHttpClients: boolean;
  enabled: boolean;
}

const defaultWAFConfig: WAFConfig = {
  rateLimit: {
    windowMs: parseInt(process.env.WAF_RATE_LIMIT_WINDOW || '60000'), // 1 minute default
    maxRequests: parseInt(process.env.WAF_RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  ipWhitelist: process.env.WAF_IP_WHITELIST 
    ? process.env.WAF_IP_WHITELIST.split(',').map(ip => ip.trim()).filter(Boolean)
    : process.env.NODE_ENV === 'development' 
      ? ['127.0.0.1', '::1', 'localhost'] // Only whitelist localhost in development
      : undefined, // No default whitelist in production
  ipBlacklist: process.env.WAF_IP_BLACKLIST 
    ? process.env.WAF_IP_BLACKLIST.split(',').map(ip => ip.trim()).filter(Boolean)
    : undefined,
  blockSuspiciousPatterns: process.env.WAF_BLOCK_SUSPICIOUS_PATTERNS !== 'false',
  blockBasicHttpClients: process.env.WAF_BLOCK_BASIC_HTTP_CLIENTS === 'true',
  enabled: process.env.WAF_ENABLED !== 'false',
};

interface PathProbeRule {
  id: string;
  pattern: RegExp;
  status: number;
  reason: string;
}

const PATH_PROBE_RULES: PathProbeRule[] = [
  {
    id: 'DOTFILE_ACCESS',
    pattern: /(^|\/)\.(?!well-known(?:\/|$))[a-z0-9._-]+/i,
    status: 404,
    reason: 'Hidden file probing detected',
  },
  {
    id: 'ENV_FILE_PROBE',
    pattern: /(^|\/)(?:[^/]*\.)?env(?:\.[a-z0-9._-]+)?$/i,
    status: 404,
    reason: 'Environment file probing detected',
  },
  {
    id: 'WP_PROBE',
    pattern: /\/(?:wp-admin|wp-content|wp-json|wordpress)(?:\/|$)|\/wp-config(?:\.php)?/i,
    status: 404,
    reason: 'WordPress probing detected',
  },
  {
    id: 'GIT_PROBE',
    pattern: /\/(?:\.git|\.svn|\.hg)(?:\/|$)/i,
    status: 404,
    reason: 'Repository metadata probing detected',
  },
  {
    id: 'SECRET_FILE_PROBE',
    pattern: /\/(?:.*(?:secret|secrets|credential|credentials|stripe|payment|config|debug|error)[^/]*\.(?:json|ya?ml|ini|conf|log|bak|old|save|backup|txt))$/i,
    status: 404,
    reason: 'Secret/config file probing detected',
  },
  {
    id: 'SENSITIVE_EXT_PROBE',
    pattern: /\/(?:.*\.(?:bak|old|save|backup|swp|tmp))$/i,
    status: 404,
    reason: 'Backup/temp file probing detected',
  },
];

export function wafMiddleware(request: NextRequest, config: WAFConfig = defaultWAFConfig) {
  // Skip WAF if disabled
  if (!config.enabled) {
    return NextResponse.next();
  }

  // Skip WAF for health check endpoints
  const url = new URL(request.url);
  if (url.pathname === '/api/health' || url.pathname.startsWith('/health')) {
    return NextResponse.next();
  }

  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || '';
  const method = request.method;
  
  // Track request for DoS detection (before any blocking logic)
  trackRequest(clientIP, userAgent, url.pathname);
  
  // 0. Check if IP is currently blocked by security monitor
  const blockCheck = checkIPBlocking(clientIP);
  if (blockCheck.block) {
    logSuspiciousActivity('IP_BLOCKED', clientIP, userAgent, request.url, {
      reason: blockCheck.reason,
      duration: blockCheck.duration,
      wafAction: 'block',
      matchedRule: 'IP_BLOCKED',
      statusCode: 403,
      method,
    });
    return createSecurityResponse(`IP blocked: ${blockCheck.reason}`, 403, 'IP_BLOCKED', 'IP_BLOCKED');
  }

  // 0b. Fast path: block common scanner/probe paths before deeper app handling
  const pathProbe = detectPathProbe(url.pathname);
  if (pathProbe.blocked) {
    const matchedRule = pathProbe.rule ?? 'PATH_PROBE';
    logSuspiciousActivity('SCANNER_DETECTED', clientIP, userAgent, request.url, {
      reason: pathProbe.reason,
      wafAction: 'block',
      matchedRule,
      statusCode: pathProbe.status,
      method,
      path: url.pathname,
    });
    return createSecurityResponse('Resource not found', pathProbe.status, 'RESOURCE_NOT_FOUND', matchedRule);
  }
  
  // 1. IP Blacklist Check
  if (config.ipBlacklist?.includes(clientIP)) {
    logSuspiciousActivity('IP_BLOCKED', clientIP, userAgent, request.url, {
      reason: 'IP in blacklist',
      wafAction: 'block',
      matchedRule: 'IP_BLACKLIST',
      statusCode: 403,
      method,
    });
    return createSecurityResponse('Access denied', 403, 'IP_BLOCKED', 'IP_BLACKLIST');
  }
  
  // 2. IP Whitelist Check (if configured)
  if (config.ipWhitelist && config.ipWhitelist.length > 0 && !config.ipWhitelist.includes(clientIP)) {
    logSuspiciousActivity('IP_BLOCKED', clientIP, userAgent, request.url, {
      reason: 'IP not in whitelist',
      wafAction: 'block',
      matchedRule: 'IP_NOT_WHITELISTED',
      statusCode: 403,
      method,
    });
    return createSecurityResponse('Access denied', 403, 'IP_NOT_WHITELISTED', 'IP_NOT_WHITELISTED');
  }
  
  // 3. Rate Limiting
  const rateLimit = checkRateLimit(clientIP, config.rateLimit);
  if (!rateLimit.allowed) {
    logSuspiciousActivity('RATE_LIMIT_EXCEEDED', clientIP, userAgent, request.url, {
      limit: config.rateLimit.maxRequests,
      window: config.rateLimit.windowMs,
      wafAction: 'block',
      matchedRule: 'RATE_LIMIT',
      statusCode: 429,
      method,
    });
    return createRateLimitResponse(rateLimit);
  }
  
  // 4. Suspicious Pattern Detection (skip for OAuth callbacks and calendar integrations)
  if (config.blockSuspiciousPatterns) {
    const pathname = new URL(request.url).pathname;
    
    // Skip pattern detection for OAuth callbacks and calendar API endpoints
    const isOAuthOrCalendar = [
      '/api/provider/calendar/connect',
      '/api/provider/calendar/callback',
      '/api/oauth/callback',
      '/api/auth/callback',
      '/callback',
      '/oauth',
      '/connect'
    ].some(path => pathname.includes(path)) || 
    pathname.includes('calendar') || 
    pathname.includes('oauth') || 
    pathname.includes('microsoft') || 
    pathname.includes('google') || 
    pathname.includes('apple');
    
    if (!isOAuthOrCalendar) {
      const suspiciousCheck = detectSuspiciousPatterns(request, {
        blockBasicHttpClients: config.blockBasicHttpClients,
      });
      if (suspiciousCheck.isSuspicious) {
        logSuspiciousActivity(
          suspiciousCheck.reason === 'SQL_INJECTION' ? 'SQL_INJECTION_ATTEMPT' :
          suspiciousCheck.reason === 'XSS' ? 'XSS_ATTEMPT' :
          suspiciousCheck.reason === 'SCANNER_DETECTED' ? 'SCANNER_DETECTED' :
          'SUSPICIOUS_LOGIN_ATTEMPT',
          clientIP,
          userAgent,
          request.url,
          {
            pattern: suspiciousCheck.reason,
            wafAction: 'block',
            matchedRule: 'SUSPICIOUS_PATTERN',
            statusCode: 403,
            method,
          }
        );
        return createSecurityResponse('Suspicious activity detected', 403, 'SUSPICIOUS_PATTERN', 'SUSPICIOUS_PATTERN');
      }
    }
  }
  
  // 5. Validate Security Headers for state-changing operations (exclude auth endpoints)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const pathname = new URL(request.url).pathname;
    
    // Skip header validation for authentication endpoints
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
      '/api/provider/calendar/callback',
      '/api/client/batch-slot-availability', // Public batch availability check
      '/api/client/booking/confirm', // Magic link confirmation
      '/api/client/booking/details', // Magic link booking details
      '/api/client/booking/reschedule', // Magic link reschedule
      '/api/client/booking/cancel', // Magic link cancellation
      '/api/admin/token-throttle', // Admin endpoint with Bearer token auth (used by pg_cron)
      '/api/admin/security-monitor', // Admin endpoint with Bearer token auth
    ];
    
    const isAuthEndpoint = authEndpoints.some(endpoint => 
      pathname === endpoint || pathname.startsWith(endpoint)
    );
    
    // CSRF/header validation only makes sense for cookie-authenticated traffic.
    // This avoids blocking legitimate machine-to-machine calls that do not rely on browser cookies.
    const hasCookies = Boolean(request.headers.get('cookie'));
    if (!isAuthEndpoint && hasCookies) {
      const headerValidation = validateSecurityHeaders(request);
      if (!headerValidation.isValid) {
        logSuspiciousActivity('CSRF_TOKEN_INVALID', clientIP, userAgent, request.url, {
          errors: headerValidation.errors,
          wafAction: 'block',
          matchedRule: 'INVALID_HEADERS',
          statusCode: 400,
          method,
        });
        return createSecurityResponse('Invalid security headers', 400, 'INVALID_HEADERS', 'INVALID_HEADERS');
      }
    }
  }
  
  // Allow request to proceed
  const response = NextResponse.next();
  
  // Add rate limit headers
  response.headers.set('X-RateLimit-Limit', config.rateLimit.maxRequests.toString());
  response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString());
  response.headers.set('X-RateLimit-Reset', new Date(rateLimit.resetTime).toISOString());
  response.headers.set('X-WAF-Action', 'allow');
  
  return response;
}

function detectPathProbe(pathname: string): { blocked: boolean; rule?: string; reason?: string; status: number } {
  const normalizedPath = pathname.toLowerCase();
  for (const rule of PATH_PROBE_RULES) {
    if (rule.pattern.test(normalizedPath)) {
      return {
        blocked: true,
        rule: rule.id,
        reason: rule.reason,
        status: rule.status,
      };
    }
  }

  return { blocked: false, status: 200 };
}

function getClientIP(request: NextRequest): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         request.headers.get('cf-connecting-ip') || // Cloudflare
         request.headers.get('x-client-ip') ||
         null;
  
  // In development, default to localhost IP if no headers present
  if (!ip && process.env.NODE_ENV === 'development') {
    return '127.0.0.1';
  }
  
  return ip || 'unknown';
}

function detectSuspiciousPatterns(
  request: NextRequest,
  options: { blockBasicHttpClients: boolean }
): { isSuspicious: boolean; reason?: string } {
  const userAgent = request.headers.get('user-agent')?.toLowerCase() || '';
  const pathname = new URL(request.url).pathname.toLowerCase();
  const searchParams = new URL(request.url).searchParams;
  
  // Skip pattern detection for legitimate OAuth parameters
  const hasOAuthParams = ['code', 'state', 'scope', 'access_token', 'refresh_token', 'client_id'].some(
    param => searchParams.has(param)
  );
  
  if (hasOAuthParams) {
    return { isSuspicious: false };
  }
  
  // Skip pattern detection for legitimate browser requests
  const legitimateBrowsers = [
    /mozilla.*firefox/i,
    /mozilla.*chrome/i,
    /mozilla.*safari/i,
    /mozilla.*edge/i,
    /opera/i,
    /webkit/i
  ];
  
  const isLegitimateUserAgent = legitimateBrowsers.some(pattern => pattern.test(userAgent));
  
  // Only check URL patterns for suspicious requests, not user agents of legitimate browsers
  const urlToCheck = pathname;
  
  // More targeted SQL Injection patterns (only in URL path/query, not user-agent)
  const sqlPatterns = [
    { pattern: /(\bunion\b.*\bselect\b|\bselect\b.*\bfrom\b)/i, type: 'SQL_INJECTION' },
    { pattern: /(\'\s*(or|and)\s*\d+\s*=\s*\d+|"\s*(or|and)\s*\d+\s*=\s*\d+)/i, type: 'SQL_INJECTION' },
    { pattern: /(\bexec\s*\(|\bexecute\s*\(|\bunion\s*all\s*select)/i, type: 'SQL_INJECTION' },
  ];
  
  // XSS patterns (only check URL, not user-agent)
  const xssPatterns = [
    { pattern: /<script[^>]*>.*<\/script>/i, type: 'XSS' },
    { pattern: /javascript\s*:\s*alert\s*\(/i, type: 'XSS' },
    { pattern: /on(load|click|error|focus)\s*=\s*["\'][^"\']*["\']/i, type: 'XSS' },
  ];
  
  // Path Traversal patterns
  const pathTraversalPatterns = [
    { pattern: /\.\.\//g, type: 'PATH_TRAVERSAL' },
    { pattern: /\/etc\/passwd|\/etc\/shadow|c:\\windows\\system32/i, type: 'PATH_TRAVERSAL' },
  ];
  
  // Command Injection patterns (very specific)
  const commandPatterns = [
    { pattern: /[;&|`]\s*(rm|cat|ls|ps|wget|curl|nc|netcat)\s+/i, type: 'COMMAND_INJECTION' },
  ];
  
  // Check URL patterns only
  const allPatterns = [...sqlPatterns, ...xssPatterns, ...pathTraversalPatterns, ...commandPatterns];
  
  for (const { pattern, type } of allPatterns) {
    if (pattern.test(urlToCheck)) {
      return { isSuspicious: true, reason: type };
    }
  }
  
  // Only flag obviously malicious user agents, not legitimate browsers or OAuth clients
  if (!isLegitimateUserAgent) {
    const maliciousUserAgentPatterns = [
      /nikto|nessus|openvas|sqlmap|burp|nmap|masscan/i,
      /gobuster|dirb|dirbuster|wfuzz|ffuf/i,
    ];

    if (options.blockBasicHttpClients) {
      maliciousUserAgentPatterns.push(/^curl\/|^wget\/|^python-requests/i);
    }
    
    // Don't flag legitimate OAuth client libraries
    const legitOAuthClients = [
      /microsoft|google|apple|oauth/i,
      /graph\.microsoft\.com|googleapis\.com|appleid\.apple\.com/i
    ];
    
    const isLegitOAuthClient = legitOAuthClients.some(pattern => pattern.test(userAgent));
    
    if (!isLegitOAuthClient) {
      for (const pattern of maliciousUserAgentPatterns) {
        if (pattern.test(userAgent)) {
          return { isSuspicious: true, reason: 'SCANNER_DETECTED' };
        }
      }
    }
  }
  
  return { isSuspicious: false };
}

function createSecurityResponse(message: string, status: number, code: string, matchedRule: string) {
  return new NextResponse(
    JSON.stringify({
      error: 'Security violation',
      message,
      code,
      wafAction: 'block',
      matchedRule,
      timestamp: new Date().toISOString(),
    }),
    { 
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-WAF-Action': 'block',
        'X-WAF-Rule': matchedRule,
      }
    }
  );
}

function createRateLimitResponse(rateLimit: { remaining: number; resetTime: number }) {
  return new NextResponse(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: 'Too many requests',
      resetTime: new Date(rateLimit.resetTime).toISOString(),
    }),
    { 
      status: 429,
      headers: { 
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString(),
        'Cache-Control': 'no-store',
        'X-WAF-Action': 'block',
        'X-WAF-Rule': 'RATE_LIMIT',
      }
    }
  );
}