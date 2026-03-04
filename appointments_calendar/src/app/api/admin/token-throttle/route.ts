// Admin endpoint for monitoring token refresh throttling
import { NextRequest, NextResponse } from 'next/server';
import { TokenRefreshThrottleService } from '@/lib/token-refresh-throttle';

// Simple auth check for admin endpoints
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || 'change-this-secret-in-production';
  
  return authHeader === `Bearer ${adminSecret}`;
}

export async function GET(request: NextRequest) {
  // Auth check for monitoring endpoint
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const stats = TokenRefreshThrottleService.getThrottleStats();
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      throttleStats: stats,
      summary: {
        activeRefreshes: stats.activeRefreshes,
        connectionsBeingTracked: stats.connectionsWithAttempts,
        totalRecentAttempts: stats.totalAttempts,
        rateLimits: {
          maxAttemptsPerConnection: stats.limits.MAX_ATTEMPTS_PER_CONNECTION,
          timeWindowMinutes: stats.limits.TIME_WINDOW / 60000,
          minSuccessIntervalMinutes: stats.limits.MIN_SUCCESS_INTERVAL / 60000,
          maxConcurrentRefreshes: stats.limits.MAX_CONCURRENT_REFRESHES
        }
      }
    });
  } catch (error) {
    console.error('Error getting throttle stats:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to get throttle statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Manual trigger for throttled refresh (for testing/admin use)
export async function POST(request: NextRequest) {
  // Auth check for POST endpoint
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const results = await TokenRefreshThrottleService.refreshExpiringTokensThrottled();
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results: {
        connectionsChecked: results.checked,
        tokensRefreshed: results.refreshed,
        requestsThrottled: results.throttled,
        errors: results.errors,
        details: results.details
      }
    });
  } catch (error) {
    console.error('Error during manual token refresh:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Manual token refresh failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}