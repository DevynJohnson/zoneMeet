/**
 * JWT Token Blacklist for Session Revocation
 * In-memory implementation (use Redis in production for multi-server deployments)
 */

interface BlacklistedToken {
  token: string;
  expiresAt: Date;
  reason: 'logout' | 'password_change' | 'security' | 'admin_revoke';
  revokedAt: Date;
}

class TokenBlacklist {
  private blacklist = new Map<string, BlacklistedToken>();
  
  constructor() {
    // Clean up expired tokens every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }
  
  /**
   * Add token to blacklist
   */
  revoke(token: string, expiresAt: Date, reason: BlacklistedToken['reason'] = 'logout'): void {
    const tokenHash = this.hashToken(token);
    
    this.blacklist.set(tokenHash, {
      token: tokenHash, // Store hash, not actual token
      expiresAt,
      reason,
      revokedAt: new Date(),
    });
    
    console.log(`🚫 Token revoked: ${reason} (expires: ${expiresAt.toISOString()})`);
  }
  
  /**
   * Check if token is blacklisted
   */
  isRevoked(token: string): boolean {
    const tokenHash = this.hashToken(token);
    const entry = this.blacklist.get(tokenHash);
    
    if (!entry) {
      return false;
    }
    
    // Check if token expiry has passed
    if (new Date() > entry.expiresAt) {
      this.blacklist.delete(tokenHash);
      return false;
    }
    
    return true;
  }
  
  /**
   * Revoke all tokens for a specific user
   * Used when password changes or account is compromised
   */
  revokeAllUserTokens(providerId: string): void {
    console.log(`🚫 Revoking all tokens for provider: ${providerId}`);
    // In a production system with Redis:
    // - Store user:providerId:revoked_at timestamp
    // - Check this timestamp against token iat (issued at) claim
    // For now, this is a placeholder - actual implementation would need
    // to store provider-specific revocation timestamps
  }
  
  /**
   * Clean up expired tokens from blacklist
   */
  private cleanup(): void {
    const now = new Date();
    let removed = 0;
    
    for (const [hash, entry] of this.blacklist.entries()) {
      if (now > entry.expiresAt) {
        this.blacklist.delete(hash);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} expired tokens from blacklist`);
    }
  }
  
  /**
   * Hash token for storage (for security - don't store raw JWT)
   */
  private hashToken(token: string): string {
    // Simple hash for in-memory storage
    // In production with Redis, use crypto.createHash('sha256')
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }
  
  /**
   * Get blacklist statistics
   */
  getStats(): { total: number; byReason: Record<string, number> } {
    const byReason: Record<string, number> = {
      logout: 0,
      password_change: 0,
      security: 0,
      admin_revoke: 0,
    };
    
    for (const entry of this.blacklist.values()) {
      byReason[entry.reason]++;
    }
    
    return {
      total: this.blacklist.size,
      byReason,
    };
  }
}

// Export singleton instance
export const tokenBlacklist = new TokenBlacklist();
