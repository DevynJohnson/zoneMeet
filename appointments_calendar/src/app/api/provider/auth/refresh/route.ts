// Token refresh endpoint
import { NextRequest, NextResponse } from 'next/server';
import { TokenRefreshService } from '@/lib/token-refresh-service';
import { addSecurityHeaders } from '@/lib/security-headers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      const errorResponse = NextResponse.json(
        { error: 'Refresh token is required' },
        { status: 400 }
      );
      return addSecurityHeaders(errorResponse);
    }

    // Refresh the access token
    const tokens = await TokenRefreshService.refreshAccessToken(refreshToken);

    // Return new token pair
    const response = NextResponse.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.accessTokenExpiry.toISOString(),
    });

    return addSecurityHeaders(response);

  } catch (error) {
    console.error('Token refresh error:', error);
    
    const errorResponse = NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Token refresh failed',
        code: 'REFRESH_FAILED'
      },
      { status: 401 }
    );

    return addSecurityHeaders(errorResponse);
  }
}
