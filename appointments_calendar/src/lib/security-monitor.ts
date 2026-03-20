/**
 * Comprehensive Security Monitoring System for Zone Meet
 * Integrates with Sentry, provides real-time alerting, and tracks security metrics
 */

import * as Sentry from '@sentry/nextjs';

// Security event types for monitoring
export type SecurityEventType = 
  | 'AUTHENTICATION_FAILURE'
  | 'SUSPICIOUS_LOGIN_ATTEMPT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'XSS_ATTEMPT'
  | 'SQL_INJECTION_ATTEMPT'
  | 'CSRF_TOKEN_INVALID'
  | 'IP_BLOCKED'
  | 'SCANNER_DETECTED'
  | 'UNAUTHORIZED_API_ACCESS'
  | 'FILE_UPLOAD_VIOLATION'
  | 'PRIVILEGE_ESCALATION_ATTEMPT'
  | 'DOS_ATTACK_DETECTED';

export interface SecurityEvent {
  type: SecurityEventType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: string;
  ip: string;
  userAgent: string;
  userId?: string;
  url: string;
  details: Record<string, unknown>;
  statusCode?: number;
  wafAction?: 'allow' | 'block' | 'challenge';
  matchedRule?: string;
  fingerprint?: string;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsByType: Record<SecurityEventType, number>;
  eventsBySeverity: Record<string, number>;
  uniqueIPs: Set<string>;
  timeWindow: string;
}

// Interface for tracking request rates
interface RequestLog {
  ip: string;
  timestamp: number;
  userAgent: string;
  url: string;
}

// In-memory storage for metrics (in production, use Redis or database)
class SecurityMonitor {
  private events: SecurityEvent[] = [];
  private maxEvents = 10000; // Keep last 10k events in memory
  private requestLogs: RequestLog[] = [];
  private maxRequestLogs = 50000; // Track last 50k requests for DoS detection
  private dosAlertedIPs: Map<string, number> = new Map(); // Track IPs we've already alerted about
  
  constructor() {
    // Clean up old events periodically
    setInterval(() => this.cleanupOldEvents(), 60 * 60 * 1000); // Every hour
    setInterval(() => this.cleanupRequestLogs(), 10 * 60 * 1000); // Every 10 minutes
  }
  
  /**
   * Log a security event
   */
  logEvent(event: Omit<SecurityEvent, 'timestamp' | 'fingerprint'>): void {
    const statusCode =
      typeof event.details?.statusCode === 'number' ? (event.details.statusCode as number) : event.statusCode;
    const wafActionRaw =
      typeof event.details?.wafAction === 'string' ? event.details.wafAction : event.wafAction;
    const matchedRule =
      typeof event.details?.matchedRule === 'string' ? (event.details.matchedRule as string) : event.matchedRule;

    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      statusCode,
      wafAction: wafActionRaw === 'allow' || wafActionRaw === 'block' || wafActionRaw === 'challenge' ? wafActionRaw : undefined,
      matchedRule,
      fingerprint: this.generateFingerprint(event),
    };
    
    // Add to local storage
    this.events.push(securityEvent);
    
    // Maintain max events limit
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    
    // Log to console
    this.logToConsole(securityEvent);
    
    // Send to Sentry
    this.sendToSentry(securityEvent);
    
    // Check for alert conditions
    this.checkAlertConditions(securityEvent);
  }
  
  /**
   * Track a request for DoS detection
   */
  trackRequest(ip: string, userAgent: string, url: string): void {
    // Skip tracking for localhost in development
    if (process.env.NODE_ENV === 'development' && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
      return;
    }
    
    this.requestLogs.push({
      ip,
      timestamp: Date.now(),
      userAgent,
      url,
    });
    
    // Maintain max logs limit
    if (this.requestLogs.length > this.maxRequestLogs) {
      this.requestLogs = this.requestLogs.slice(-this.maxRequestLogs);
    }
    
    // Check for DoS patterns
    this.checkForDoSPattern(ip, userAgent, url);
  }
  
  /**
   * Detect DoS attack patterns
   */
  private checkForDoSPattern(ip: string, userAgent: string, url: string): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    
    // Get requests from this IP in the last 1 and 5 minutes
    const requestsLastMinute = this.requestLogs.filter(
      log => log.ip === ip && log.timestamp > oneMinuteAgo
    ).length;
    
    const requestsLastFiveMinutes = this.requestLogs.filter(
      log => log.ip === ip && log.timestamp > fiveMinutesAgo
    ).length;
    
    // Check if we've already alerted about this IP recently (within last 5 minutes)
    const lastAlert = this.dosAlertedIPs.get(ip);
    if (lastAlert && (now - lastAlert) < 5 * 60 * 1000) {
      return; // Don't spam alerts for the same IP
    }
    
    // DoS detection thresholds
    const DOS_THRESHOLD_1MIN = 50; // 50+ requests in 1 minute
    const DOS_THRESHOLD_5MIN = 150; // 150+ requests in 5 minutes
    
    if (requestsLastMinute >= DOS_THRESHOLD_1MIN) {
      this.dosAlertedIPs.set(ip, now);
      this.logEvent({
        type: 'DOS_ATTACK_DETECTED',
        severity: 'HIGH',
        ip,
        userAgent,
        url,
        details: {
          requestsInLastMinute: requestsLastMinute,
          requestsInLastFiveMinutes: requestsLastFiveMinutes,
          pattern: 'rapid_fire_requests',
        },
      });
    } else if (requestsLastFiveMinutes >= DOS_THRESHOLD_5MIN) {
      this.dosAlertedIPs.set(ip, now);
      this.logEvent({
        type: 'DOS_ATTACK_DETECTED',
        severity: 'HIGH',
        ip,
        userAgent,
        url,
        details: {
          requestsInLastMinute: requestsLastMinute,
          requestsInLastFiveMinutes: requestsLastFiveMinutes,
          pattern: 'sustained_attack',
        },
      });
    }
  }
  
  /**
   * Get request statistics for an IP
   */
  getRequestStats(ip: string, windowMinutes: number = 60): {
    totalRequests: number;
    requestsPerMinute: number[];
    topUrls: { url: string; count: number }[];
  } {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const requests = this.requestLogs.filter(
      log => log.ip === ip && log.timestamp > cutoff
    );
    
    // Calculate requests per minute
    const minuteBuckets: Record<number, number> = {};
    requests.forEach(log => {
      const minute = Math.floor(log.timestamp / (60 * 1000));
      minuteBuckets[minute] = (minuteBuckets[minute] || 0) + 1;
    });
    const requestsPerMinute = Object.values(minuteBuckets);
    
    // Count URLs
    const urlCounts: Record<string, number> = {};
    requests.forEach(log => {
      urlCounts[log.url] = (urlCounts[log.url] || 0) + 1;
    });
    const topUrls = Object.entries(urlCounts)
      .map(([url, count]) => ({ url, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      totalRequests: requests.length,
      requestsPerMinute,
      topUrls,
    };
  }
  
  /**
   * Get list of suspicious IPs with their activity
   */
  getSuspiciousIPs(windowMinutes: number = 60): Array<{
    ip: string;
    requestCount: number;
    securityEvents: number;
    lastSeen: string;
    threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }> {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const ipStats = new Map<string, {
      requests: number;
      events: SecurityEvent[];
      lastSeen: number;
    }>();
    
    // Aggregate request counts
    this.requestLogs
      .filter(log => log.timestamp > cutoff)
      .forEach(log => {
        const stats = ipStats.get(log.ip) || { requests: 0, events: [], lastSeen: 0 };
        stats.requests++;
        stats.lastSeen = Math.max(stats.lastSeen, log.timestamp);
        ipStats.set(log.ip, stats);
      });
    
    // Aggregate security events
    this.events
      .filter(event => new Date(event.timestamp).getTime() > cutoff)
      .forEach(event => {
        const stats = ipStats.get(event.ip) || { requests: 0, events: [], lastSeen: 0 };
        stats.events.push(event);
        stats.lastSeen = Math.max(stats.lastSeen, new Date(event.timestamp).getTime());
        ipStats.set(event.ip, stats);
      });
    
    // Determine threat level and filter suspicious IPs
    const suspiciousIPs = Array.from(ipStats.entries())
      .map(([ip, stats]) => {
        const highSeverityEvents = stats.events.filter(
          e => ['HIGH', 'CRITICAL'].includes(e.severity)
        ).length;
        
        let threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
        
        // Threat level calculation
        if (highSeverityEvents >= 5 || stats.requests > 200) {
          threatLevel = 'CRITICAL';
        } else if (highSeverityEvents >= 3 || stats.requests > 100) {
          threatLevel = 'HIGH';
        } else if (stats.events.length >= 5 || stats.requests > 50) {
          threatLevel = 'MEDIUM';
        }
        
        return {
          ip,
          requestCount: stats.requests,
          securityEvents: stats.events.length,
          lastSeen: new Date(stats.lastSeen).toISOString(),
          threatLevel,
        };
      })
      .filter(item => item.securityEvents > 0 || item.requestCount > 50)
      .sort((a, b) => {
        // Sort by threat level, then by request count
        const threatOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return (threatOrder[b.threatLevel] - threatOrder[a.threatLevel]) ||
               (b.requestCount - a.requestCount);
      });
    
    return suspiciousIPs;
  }
  
  private cleanupRequestLogs(): void {
    const cutoff = Date.now() - 60 * 60 * 1000; // Keep last hour
    this.requestLogs = this.requestLogs.filter(log => log.timestamp > cutoff);
    
    // Clean up old DoS alerts
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [ip, timestamp] of this.dosAlertedIPs.entries()) {
      if (timestamp < fiveMinutesAgo) {
        this.dosAlertedIPs.delete(ip);
      }
    }
  }
  
  /**
   * Get security metrics for a time window
   */
  getMetrics(windowMinutes: number = 60): SecurityMetrics {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const recentEvents = this.events.filter(
      event => new Date(event.timestamp) > cutoff
    );
    
    const eventsByType = {} as Record<SecurityEventType, number>;
    const eventsBySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const uniqueIPs = new Set<string>();
    
    recentEvents.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsBySeverity[event.severity]++;
      uniqueIPs.add(event.ip);
    });
    
    return {
      totalEvents: recentEvents.length,
      eventsByType,
      eventsBySeverity,
      uniqueIPs,
      timeWindow: `${windowMinutes} minutes`,
    };
  }
  
  /**
   * Get events for a specific IP
   */
  getEventsForIP(ip: string, windowMinutes: number = 60): SecurityEvent[] {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    return this.events.filter(
      event => event.ip === ip && new Date(event.timestamp) > cutoff
    );
  }
  
  /**
   * Check if an IP should be temporarily blocked
   */
  shouldBlockIP(ip: string): { block: boolean; reason?: string; duration?: number } {
    // Never block localhost/development IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return { block: false };
    }
    
    const recentEvents = this.getEventsForIP(ip, 60); // Last hour
    
    // High severity events in last hour
    const highSeverityCount = recentEvents.filter(
      event => ['HIGH', 'CRITICAL'].includes(event.severity)
    ).length;
    
    if (highSeverityCount >= 5) {
      return { 
        block: true, 
        reason: 'Multiple high-severity security events', 
        duration: 60 * 60 * 1000 // 1 hour
      };
    }
    
    // Multiple failed authentication attempts
    const authFailures = recentEvents.filter(
      event => event.type === 'AUTHENTICATION_FAILURE'
    ).length;
    
    if (authFailures >= 10) {
      return { 
        block: true, 
        reason: 'Multiple authentication failures', 
        duration: 30 * 60 * 1000 // 30 minutes
      };
    }
    
    // Scanner detection
    const scannerEvents = recentEvents.filter(
      event => event.type === 'SCANNER_DETECTED'
    ).length;
    
    if (scannerEvents >= 3) {
      return { 
        block: true, 
        reason: 'Automated scanning detected', 
        duration: 24 * 60 * 60 * 1000 // 24 hours
      };
    }
    
    // DoS attacks
    const dosEvents = recentEvents.filter(
      event => event.type === 'DOS_ATTACK_DETECTED'
    ).length;
    
    if (dosEvents >= 1) {
      return { 
        block: true, 
        reason: 'DoS attack detected', 
        duration: 2 * 60 * 60 * 1000 // 2 hours
      };
    }
    
    return { block: false };
  }
  
  clearEventsForIP(ip: string): void {
    this.events = this.events.filter(event => event.ip !== ip);
  }
  
  private generateFingerprint(event: Omit<SecurityEvent, 'timestamp' | 'fingerprint'>): string {
    const key = `${event.type}_${event.ip}_${event.url}`;
    return Buffer.from(key).toString('base64').slice(0, 16);
  }
  
  private logToConsole(event: SecurityEvent): void {
    const logLevel = this.getLogLevel(event.severity);
    const message = `[SECURITY] ${event.type} from ${event.ip}`;
    
    logLevel(message, {
      timestamp: event.timestamp,
      severity: event.severity,
      url: event.url,
      userAgent: event.userAgent,
      statusCode: event.statusCode,
      wafAction: event.wafAction,
      matchedRule: event.matchedRule,
      details: event.details,
    });
  }
  
  private getLogLevel(severity: SecurityEvent['severity']) {
    switch (severity) {
      case 'CRITICAL':
      case 'HIGH':
        return console.error;
      case 'MEDIUM':
        return console.warn;
      case 'LOW':
      default:
        return console.info;
    }
  }
  
  private sendToSentry(event: SecurityEvent): void {
    try {
      Sentry.captureException(new Error(`Security Event: ${event.type}`), {
        tags: {
          security: true,
          eventType: event.type,
          severity: event.severity,
          ip: event.ip,
        },
        extra: {
          timestamp: event.timestamp,
          url: event.url,
          userAgent: event.userAgent,
          userId: event.userId,
          details: event.details,
          fingerprint: event.fingerprint,
        },
        level: this.sentryLevel(event.severity),
        fingerprint: [event.fingerprint || event.type],
      });
    } catch (error) {
      console.error('Failed to send security event to Sentry:', error);
    }
  }
  
  private sentryLevel(severity: SecurityEvent['severity']): Sentry.SeverityLevel {
    switch (severity) {
      case 'CRITICAL': return 'fatal';
      case 'HIGH': return 'error';
      case 'MEDIUM': return 'warning';
      case 'LOW': return 'info';
      default: return 'info';
    }
  }
  
  private checkAlertConditions(event: SecurityEvent): void {
    // Critical events always trigger immediate alerts
    if (event.severity === 'CRITICAL') {
      this.sendAlert({
        title: 'CRITICAL Security Event',
        message: `${event.type} detected from IP ${event.ip}`,
        event,
        urgency: 'immediate',
      });
      return;
    }
    
    // Check for attack patterns
    const recentEvents = this.getEventsForIP(event.ip, 10); // Last 10 minutes
    
    // Multiple high-severity events
    const highSeverityCount = recentEvents.filter(
      e => ['HIGH', 'CRITICAL'].includes(e.severity)
    ).length;
    
    if (highSeverityCount >= 3) {
      this.sendAlert({
        title: 'Potential Security Attack',
        message: `Multiple high-severity events from IP ${event.ip}`,
        event,
        urgency: 'high',
      });
    }
    
    // Coordinated attack detection
    const uniqueEventTypes = new Set(recentEvents.map(e => e.type));
    if (uniqueEventTypes.size >= 3) {
      this.sendAlert({
        title: 'Coordinated Attack Detected',
        message: `Multiple attack types from IP ${event.ip}`,
        event,
        urgency: 'high',
      });
    }
  }
  
  private sendAlert(alert: {
    title: string;
    message: string;
    event: SecurityEvent;
    urgency: 'immediate' | 'high' | 'medium' | 'low';
  }): void {
    // Log alert
    console.error('[SECURITY ALERT]', alert);
    
    // Send to external alerting systems
    // this.sendToSlack(alert);
    // this.sendToEmail(alert);
    // this.sendToWebhook(alert);
  }
  
  private cleanupOldEvents(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
    this.events = this.events.filter(
      event => new Date(event.timestamp) > cutoff
    );
  }
}

// Global security monitor instance
export const securityMonitor = new SecurityMonitor();

// Convenience functions
export function logSecurityEvent(
  type: SecurityEventType,
  severity: SecurityEvent['severity'],
  ip: string,
  userAgent: string,
  url: string,
  details: Record<string, unknown> = {},
  userId?: string
): void {
  securityMonitor.logEvent({
    type,
    severity,
    ip,
    userAgent,
    url,
    details,
    userId,
  });
}

export function logAuthenticationFailure(
  ip: string,
  userAgent: string,
  email?: string,
  reason?: string
): void {
  logSecurityEvent(
    'AUTHENTICATION_FAILURE',
    'MEDIUM',
    ip,
    userAgent,
    '/api/auth/login',
    { email, reason }
  );
}

export function logSuspiciousActivity(
  type: SecurityEventType,
  ip: string,
  userAgent: string,
  url: string,
  details: Record<string, unknown>
): void {
  const severity = getSeverityForEventType(type);
  logSecurityEvent(type, severity, ip, userAgent, url, details);
}

function getSeverityForEventType(type: SecurityEventType): SecurityEvent['severity'] {
  const criticalEvents: SecurityEventType[] = [
    'PRIVILEGE_ESCALATION_ATTEMPT',
  ];
  
  const highSeverityEvents: SecurityEventType[] = [
    'SQL_INJECTION_ATTEMPT',
    'XSS_ATTEMPT',
    'UNAUTHORIZED_API_ACCESS',
    'DOS_ATTACK_DETECTED',
  ];
  
  const mediumSeverityEvents: SecurityEventType[] = [
    'AUTHENTICATION_FAILURE',
    'SUSPICIOUS_LOGIN_ATTEMPT',
    'CSRF_TOKEN_INVALID',
    'FILE_UPLOAD_VIOLATION',
  ];
  
  if (criticalEvents.includes(type)) return 'CRITICAL';
  if (highSeverityEvents.includes(type)) return 'HIGH';
  if (mediumSeverityEvents.includes(type)) return 'MEDIUM';
  return 'LOW';
}

// API endpoint helpers
export function getSecurityMetrics(windowMinutes?: number): SecurityMetrics {
  return securityMonitor.getMetrics(windowMinutes);
}

export function getIPEvents(ip: string, windowMinutes?: number): SecurityEvent[] {
  return securityMonitor.getEventsForIP(ip, windowMinutes);
}

export function checkIPBlocking(ip: string): { block: boolean; reason?: string; duration?: number } {
  return securityMonitor.shouldBlockIP(ip);
}

export function clearIPEvents(ip: string): void {
  return securityMonitor.clearEventsForIP(ip);
}

// Request tracking exports
export function trackRequest(ip: string, userAgent: string, url: string): void {
  return securityMonitor.trackRequest(ip, userAgent, url);
}

export function getRequestStats(ip: string, windowMinutes?: number) {
  return securityMonitor.getRequestStats(ip, windowMinutes);
}

export function getSuspiciousIPs(windowMinutes?: number) {
  return securityMonitor.getSuspiciousIPs(windowMinutes);
}