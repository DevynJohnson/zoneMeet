// Provider logout API endpoint - CRITICAL SECURITY FIX
import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyJWT } from '@/lib/jwt-utils';
import { prisma } from '@/lib/db';
import { tokenBlacklist } from '@/lib/token-blacklist';
import { TokenRefreshService } from '@/lib/token-refresh-service';

export async function POST(request: NextRequest) {
  try {
    // Extract and verify JWT
    const authHeader = request.headers.get('authorization');
    const jwtResult = extractAndVerifyJWT(authHeader);
    
    if (!jwtResult.success) {
      console.warn('Logout attempted with invalid token:', jwtResult.error);
      // Even if token is invalid, still return success for logout
      return NextResponse.json({ success: true, message: 'Logged out successfully' });
    }

    const providerId = jwtResult.payload!.providerId;
    const providerEmail = jwtResult.payload!.email;
    const accessToken = authHeader?.split(' ')[1] || '';

    console.log(`🔒 Provider logout: ${providerEmail} (${providerId})`);

    // Revoke the access token (add to blacklist)
    if (accessToken) {
      tokenBlacklist.revoke(
        accessToken, 
        new Date(jwtResult.payload!.exp! * 1000), // JWT exp is in seconds
        'logout'
      );
    }

    // Revoke all refresh tokens for this provider
    await TokenRefreshService.revokeAllProviderTokens(providerId);

    // Update provider's lastLoginAt to track logout time
    try {
      await prisma.provider.update({
        where: { id: providerId },
        data: { updatedAt: new Date() }
      });
    } catch (dbError) {
      console.warn('Failed to update provider logout time:', dbError);
      // Don't fail logout if DB update fails
    }

    // Return success response with cache-clearing headers
    const response = NextResponse.json({ 
      success: true, 
      message: 'Logged out successfully',
      providerId // Include for client-side verification
    });

    // Add security headers to prevent caching
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;

  } catch (error) {
    console.error('Logout error:', error);
    
    // Even if logout fails server-side, return success
    // Client should clear tokens regardless
    return NextResponse.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  }
}