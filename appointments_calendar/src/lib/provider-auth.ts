// Provider authentication service
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/db';
import { tokenBlacklist } from '@/lib/token-blacklist';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

export class ProviderAuthService {
  /**
   * Create a new provider account
   */
  static async createProvider(data: {
    name: string;
    email: string;
    phone: string;
    password: string;
    company?: string;
    title?: string;
    bio?: string;
  }) {
    // Check if provider already exists
    const existingProvider = await prisma.provider.findUnique({
      where: { email: data.email },
    });

    if (existingProvider) {
      throw new Error('Provider already exists with this email');
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(data.password, saltRounds);

    // Create provider
    const provider = await prisma.provider.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        company: data.company,
        title: data.title,
        bio: data.bio,
        isActive: true,
      },
    });

    // Remove password hash from response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...providerWithoutPassword } = provider;
    return providerWithoutPassword;
  }

  /**
   * Authenticate provider login
   */
  static async authenticateProvider(email: string, password: string) {
    const provider = await prisma.provider.findUnique({
      where: { email },
    });

    if (!provider || !provider.passwordHash) {
      throw new Error('Invalid credentials');
    }

    if (!provider.isActive) {
      throw new Error('Account is deactivated');
    }

    const isValidPassword = await bcrypt.compare(password, provider.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    // Update last login
    await prisma.provider.update({
      where: { id: provider.id },
      data: { updatedAt: new Date() },
    });

    // Generate JWT token
    const token = jwt.sign(
      { 
        providerId: provider.id, 
        email: provider.email,
        type: 'provider' 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...providerWithoutPassword } = provider;
    return {
      provider: providerWithoutPassword,
      token,
    };
  }

  /**
   * Verify JWT token
   */
  static async verifyToken(token: string) {
    try {
      // Check if token is blacklisted (revoked)
      if (tokenBlacklist.isRevoked(token)) {
        throw new Error('Token has been revoked');
      }

      const decoded = jwt.verify(token, JWT_SECRET) as {
        providerId: string;
        email: string;
        type: string;
        exp?: number;
      };

      if (decoded.type !== 'provider' && decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }

      const provider = await prisma.provider.findUnique({
        where: { id: decoded.providerId },
      });

      if (!provider || !provider.isActive) {
        throw new Error('Provider not found or inactive');
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash: _, ...providerWithoutPassword } = provider;
      return providerWithoutPassword;
    } catch (error) {
      // Log the specific error for debugging but don't expose details to client
      console.warn('Token verification failed:', error instanceof Error ? error.message : 'Unknown error');
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Change provider password
   */
  static async changePassword(providerId: string, currentPassword: string, newPassword: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
    });

    if (!provider || !provider.passwordHash) {
      throw new Error('Provider not found');
    }

    const isValidCurrentPassword = await bcrypt.compare(currentPassword, provider.passwordHash);
    if (!isValidCurrentPassword) {
      throw new Error('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    
    await prisma.provider.update({
      where: { id: providerId },
      data: { passwordHash: newPasswordHash },
    });

    return { success: true };
  }
}
