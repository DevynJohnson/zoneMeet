import { NextRequest, NextResponse } from 'next/server';
import { TokenMaintenanceService } from '@/lib/token-maintenance';

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || 'change-this-secret-in-production';
  return authHeader === `Bearer ${adminSecret}`;
}

export async function POST(request: NextRequest) {
  // Verify admin authentication
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    console.log('🔄 Starting proactive token refresh maintenance...');
    
    // Refresh expiring tokens
    const refreshResults = await TokenMaintenanceService.refreshExpiringTokens();
    
    // Clean up expired connections
    const cleanupResults = await TokenMaintenanceService.cleanupExpiredConnections();
    
    // Get health statistics
    const healthStats = await TokenMaintenanceService.getTokenHealthStats();
    
    console.log(`✅ Token maintenance completed: ${refreshResults.successCount}/${refreshResults.totalChecked} tokens refreshed, ${cleanupResults.disabledCount} connections cleaned up`);
    
    return NextResponse.json({
      success: true,
      message: 'Token maintenance completed successfully',
      refresh: {
        totalChecked: refreshResults.totalChecked,
        successful: refreshResults.successCount,
        failed: refreshResults.failureCount
      },
      cleanup: {
        disabled: cleanupResults.disabledCount
      },
      health: healthStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Token maintenance failed:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Token maintenance failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Verify admin authentication
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    // Just return health statistics for monitoring
    const healthStats = await TokenMaintenanceService.getTokenHealthStats();
    
    return NextResponse.json({
      success: true,
      health: healthStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Failed to get token health stats:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to get token health statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}