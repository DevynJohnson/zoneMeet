import { NextRequest, NextResponse } from 'next/server';
import { 
  getSecurityMetrics, 
  getSuspiciousIPs, 
  getIPEvents, 
  getRequestStats,
  checkIPBlocking,
  clearIPEvents,
} from '@/lib/security-monitor';

/**
 * Security Monitoring Admin Endpoint
 * GET: View security metrics and suspicious IPs
 * POST: Perform actions (clear events, block/unblock IPs)
 */

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.substring(7);
  const adminSecret = process.env.ADMIN_SECRET;
  
  if (!adminSecret) {
    return false;
  }
  
  return token === adminSecret;
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const ip = searchParams.get('ip');
    const windowMinutes = parseInt(searchParams.get('window') || '60');
    
    // Get specific IP details
    if (action === 'ip-details' && ip) {
      const events = getIPEvents(ip, windowMinutes);
      const stats = getRequestStats(ip, windowMinutes);
      const blockStatus = checkIPBlocking(ip);
      
      return NextResponse.json({
        ip,
        window: `${windowMinutes} minutes`,
        blockStatus,
        securityEvents: events.map(event => ({
          type: event.type,
          severity: event.severity,
          timestamp: event.timestamp,
          url: event.url,
          details: event.details,
        })),
        requestStats: stats,
      });
    }
    
    // Get suspicious IPs list
    if (action === 'suspicious-ips') {
      const suspiciousIPs = getSuspiciousIPs(windowMinutes);
      
      return NextResponse.json({
        window: `${windowMinutes} minutes`,
        count: suspiciousIPs.length,
        ips: suspiciousIPs,
      });
    }
    
    // Default: Get overall security metrics
    const metrics = getSecurityMetrics(windowMinutes);
    const suspiciousIPs = getSuspiciousIPs(windowMinutes);
    
    return NextResponse.json({
      window: `${windowMinutes} minutes`,
      metrics: {
        totalEvents: metrics.totalEvents,
        eventsByType: metrics.eventsByType,
        eventsBySeverity: metrics.eventsBySeverity,
        uniqueIPs: Array.from(metrics.uniqueIPs),
        uniqueIPCount: metrics.uniqueIPs.size,
      },
      suspiciousIPs: suspiciousIPs.slice(0, 20), // Top 20 suspicious IPs
      recommendations: generateRecommendations(suspiciousIPs),
    });
  } catch (error) {
    console.error('Security monitor endpoint error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { action, ip } = body;
    
    if (!action) {
      return NextResponse.json(
        { error: 'Missing action parameter' },
        { status: 400 }
      );
    }
    
    // Clear events for a specific IP
    if (action === 'clear-events' && ip) {
      clearIPEvents(ip);
      return NextResponse.json({
        success: true,
        message: `Cleared security events for IP: ${ip}`,
      });
    }
    
    // Note: IP blocking is handled via environment variables (WAF_IP_BLACKLIST)
    // This endpoint provides monitoring and manual clearance only
    
    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Security monitor endpoint error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateRecommendations(suspiciousIPs: Array<{
  ip: string;
  requestCount: number;
  securityEvents: number;
  threatLevel: string;
}>): string[] {
  const recommendations: string[] = [];
  
  const criticalIPs = suspiciousIPs.filter(item => item.threatLevel === 'CRITICAL');
  const highThreatIPs = suspiciousIPs.filter(item => item.threatLevel === 'HIGH');
  
  if (criticalIPs.length > 0) {
    recommendations.push(
      `🚨 ${criticalIPs.length} CRITICAL threat IP(s) detected. Consider adding to WAF_IP_BLACKLIST: ${criticalIPs.map(i => i.ip).join(', ')}`
    );
  }
  
  if (highThreatIPs.length > 0) {
    recommendations.push(
      `⚠️  ${highThreatIPs.length} HIGH threat IP(s) detected. Monitor closely: ${highThreatIPs.slice(0, 3).map(i => i.ip).join(', ')}${highThreatIPs.length > 3 ? '...' : ''}`
    );
  }
  
  const dosAttacks = suspiciousIPs.filter(
    item => item.requestCount > 100 && item.threatLevel !== 'LOW'
  );
  
  if (dosAttacks.length > 0) {
    recommendations.push(
      `🔥 ${dosAttacks.length} potential DoS attack(s) detected with high request volumes`
    );
  }
  
  if (recommendations.length === 0) {
    recommendations.push('✅ No immediate security threats detected');
  }
  
  return recommendations;
}
