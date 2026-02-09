/**
 * Account Lockout System
 * Progressive lockout for brute force protection
 */

interface LockoutEntry {
  attemptCount: number;
  lastAttempt: Date;
  lockedUntil: Date | null;
  permanentLock: boolean;
}

class AccountLockoutService {
  private lockouts = new Map<string, LockoutEntry>();
  
  // Lockout configuration
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MINUTES = [1, 5, 15, 30, 60]; // Progressive lockout
  private readonly PERMANENT_LOCKOUT_THRESHOLD = 10;
  private readonly RESET_WINDOW_MINUTES = 30; // Reset counter after this period of no attempts
  
  constructor() {
    // Clean up old entries every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }
  
  /**
   * Check if account is currently locked
   */
  isLocked(identifier: string): { locked: boolean; unlockAt?: Date; reason?: string } {
    const entry = this.lockouts.get(identifier);
    
    if (!entry) {
      return { locked: false };
    }
    
    // Check for permanent lock
    if (entry.permanentLock) {
      return { 
        locked: true, 
        reason: 'Account permanently locked due to excessive failed attempts. Contact support.' 
      };
    }
    
    // Check if temporary lock has expired
    if (entry.lockedUntil && new Date() < entry.lockedUntil) {
      return { 
        locked: true, 
        unlockAt: entry.lockedUntil,
        reason: `Account temporarily locked until ${entry.lockedUntil.toLocaleTimeString()}`
      };
    }
    
    // Lock expired, reset if enough time has passed
    if (entry.lockedUntil && new Date() > entry.lockedUntil) {
      const timeSinceLastAttempt = Date.now() - entry.lastAttempt.getTime();
      const resetWindowMs = this.RESET_WINDOW_MINUTES * 60 * 1000;
      
      if (timeSinceLastAttempt > resetWindowMs) {
        this.lockouts.delete(identifier);
      }
    }
    
    return { locked: false };
  }
  
  /**
   * Record failed login attempt
   */
  recordFailedAttempt(identifier: string): void {
    const entry = this.lockouts.get(identifier) || {
      attemptCount: 0,
      lastAttempt: new Date(),
      lockedUntil: null,
      permanentLock: false,
    };
    
    entry.attemptCount++;
    entry.lastAttempt = new Date();
    
    // Check for permanent lockout
    if (entry.attemptCount >= this.PERMANENT_LOCKOUT_THRESHOLD) {
      entry.permanentLock = true;
      console.warn(`🔒 PERMANENT LOCKOUT: ${identifier} (${entry.attemptCount} failed attempts)`);
      
      // TODO: Send alert to security team
      this.sendSecurityAlert(identifier, 'permanent_lockout');
    }
    // Progressive temporary lockout
    else if (entry.attemptCount >= this.MAX_ATTEMPTS) {
      const lockoutIndex = Math.min(
        entry.attemptCount - this.MAX_ATTEMPTS,
        this.LOCKOUT_DURATION_MINUTES.length - 1
      );
      const lockoutMinutes = this.LOCKOUT_DURATION_MINUTES[lockoutIndex];
      entry.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      
      console.warn(
        `⏰ TEMPORARY LOCKOUT: ${identifier} locked for ${lockoutMinutes} min (attempt ${entry.attemptCount})`
      );
    }
    
    this.lockouts.set(identifier, entry);
  }
  
  /**
   * Record successful login (reset counter)
   */
  recordSuccessfulLogin(identifier: string): void {
    const entry = this.lockouts.get(identifier);
    
    if (entry && !entry.permanentLock) {
      this.lockouts.delete(identifier);
      console.log(`✅ Login successful: ${identifier} (lockout counter reset)`);
    }
  }
  
  /**
   * Manually unlock account (admin function)
   */
  unlock(identifier: string): boolean {
    const entry = this.lockouts.get(identifier);
    
    if (!entry) {
      return false;
    }
    
    this.lockouts.delete(identifier);
    console.log(`🔓 Account manually unlocked: ${identifier}`);
    return true;
  }
  
  /**
   * Get remaining attempts before lockout
   */
  getRemainingAttempts(identifier: string): number {
    const entry = this.lockouts.get(identifier);
    
    if (!entry || entry.permanentLock) {
      return 0;
    }
    
    return Math.max(0, this.MAX_ATTEMPTS - entry.attemptCount);
  }
  
  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const cutoff = new Date(Date.now() - this.RESET_WINDOW_MINUTES * 60 * 1000);
    let removed = 0;
    
    for (const [identifier, entry] of this.lockouts.entries()) {
      // Don't remove permanent locks
      if (entry.permanentLock) {
        continue;
      }
      
      // Remove if last attempt was long ago and no active lock
      if (entry.lastAttempt < cutoff && (!entry.lockedUntil || new Date() > entry.lockedUntil)) {
        this.lockouts.delete(identifier);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} expired lockout entries`);
    }
  }
  
  /**
   * Send security alert (placeholder - implement actual alerting)
   */
  private sendSecurityAlert(identifier: string, type: string): void {
    // TODO: Implement actual alerting (email, Slack, PagerDuty, etc.)
    console.error(`🚨 SECURITY ALERT: ${type} for ${identifier}`);
  }
  
  /**
   * Get lockout statistics
   */
  getStats(): {
    totalLocked: number;
    permanentLocks: number;
    temporaryLocks: number;
  } {
    let totalLocked = 0;
    let permanentLocks = 0;
    let temporaryLocks = 0;
    
    for (const entry of this.lockouts.values()) {
      if (entry.permanentLock) {
        permanentLocks++;
        totalLocked++;
      } else if (entry.lockedUntil && new Date() < entry.lockedUntil) {
        temporaryLocks++;
        totalLocked++;
      }
    }
    
    return {
      totalLocked,
      permanentLocks,
      temporaryLocks,
    };
  }
}

// Export singleton instance
export const accountLockout = new AccountLockoutService();
