/**
 * Token Refresh System
 * Implements secure token refresh flow with rotation
 */

import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || 'your-refresh-secret';

export class TokenRefreshService {
  // Access token: short-lived (1 hour)
  private static readonly ACCESS_TOKEN_EXPIRY = '1h';
  
  // Refresh token: longer-lived (7 days)
  private static readonly REFRESH_TOKEN_EXPIRY = '7d';
  
  // Max refresh tokens per user (device limit)
  private static readonly MAX_REFRESH_TOKENS_PER_USER = 5;
  
  /**
   * Generate access and refresh token pair
   */
  static async generateTokenPair(providerId: string, email: string): Promise<{
    accessToken: string;
    refreshToken: string;
    accessTokenExpiry: Date;
    refreshTokenExpiry: Date;
  }> {
    // Generate access token (short-lived)
    const accessToken = jwt.sign(
      {
        providerId,
        email,
        type: 'access',
      },
      JWT_SECRET,
      { expiresIn: this.ACCESS_TOKEN_EXPIRY }
    );
    
    // Generate refresh token (long-lived)
    const refreshToken = jwt.sign(
      {
        providerId,
        type: 'refresh',
      },
      REFRESH_TOKEN_SECRET,
      { expiresIn: this.REFRESH_TOKEN_EXPIRY }
    );
    
    const now = new Date();
    const accessTokenExpiry = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
    const refreshTokenExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Store refresh token in database
    await this.storeRefreshToken(refreshToken, providerId, refreshTokenExpiry);
    
    return {
      accessToken,
      refreshToken,
      accessTokenExpiry,
      refreshTokenExpiry,
    };
  }
  
  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    accessTokenExpiry: Date;
    refreshTokenExpiry: Date;
  }> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as {
        providerId: string;
        type: string;
      };
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      
      // Check if token exists and is not revoked in database
      const tokenData = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });
      
      if (!tokenData || tokenData.isRevoked) {
        throw new Error('Refresh token has been revoked');
      }
      
      // Verify provider still exists and is active
      const provider = await prisma.provider.findUnique({
        where: { id: decoded.providerId },
      });
      
      if (!provider || !provider.isActive) {
        throw new Error('Provider not found or inactive');
      }
      
      // Generate new token pair (token rotation for security)
      const newTokens = await this.generateTokenPair(provider.id, provider.email);
      
      // Revoke old refresh token (rotation - use once)
      await this.revokeRefreshToken(refreshToken);
      
      console.log(`🔄 Token refreshed for provider ${provider.id}`);
      
      return newTokens;
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Invalid or expired refresh token');
    }
  }
  
  /**
   * Revoke a specific refresh token
   */
  static async revokeRefreshToken(tokenString: string): Promise<void> {
    try {
      await prisma.refreshToken.update({
        where: { token: tokenString },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
        },
      });
      console.log(`🚫 Refresh token revoked`);
    } catch (error) {
      console.error('Failed to revoke refresh token:', error);
    }
  }
  
  /**
   * Revoke all refresh tokens for a provider (used when password changes)
   */
  static async revokeAllProviderTokens(providerId: string): Promise<void> {
    try {
      await prisma.refreshToken.updateMany({
        where: { providerId },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
        },
      });
      console.log(`🚫 All refresh tokens revoked for provider ${providerId}`);
    } catch (error) {
      console.error('Failed to revoke provider tokens:', error);
    }
  }
  
  /**
   * Store refresh token in database
   */
  private static async storeRefreshToken(
    tokenString: string,
    providerId: string,
    expiresAt: Date
  ): Promise<void> {
    try {
      // Enforce token limit per user
      const existingTokens = await prisma.refreshToken.count({
        where: {
          providerId,
          isRevoked: false,
          expiresAt: { gt: new Date() },
        },
      });
      
      if (existingTokens >= this.MAX_REFRESH_TOKENS_PER_USER) {
        // Revoke oldest token
        const oldestToken = await prisma.refreshToken.findFirst({
          where: {
            providerId,
            isRevoked: false,
          },
          orderBy: { createdAt: 'asc' },
        });
        
        if (oldestToken) {
          await this.revokeRefreshToken(oldestToken.token);
        }
      }
      
      // Create new refresh token record
      await prisma.refreshToken.create({
        data: {
          token: tokenString,
          providerId,
          expiresAt,
        },
      });
    } catch (error) {
      console.error('Failed to store refresh token:', error);
      throw error;
    }
  }
  
  /**
   * Clean up expired refresh tokens (run periodically)
   */
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { isRevoked: true },
          ],
        },
      });
      
      console.log(`🧹 Cleaned up ${result.count} expired/revoked refresh tokens`);
      return result.count;
    } catch (error) {
      console.error('Failed to cleanup refresh tokens:', error);
      return 0;
    }
  }
}

// Run cleanup every 24 hours
setInterval(() => {
  TokenRefreshService.cleanupExpiredTokens().catch(err => {
    console.error('Periodic token cleanup failed:', err);
  });
}, 24 * 60 * 60 * 1000);
