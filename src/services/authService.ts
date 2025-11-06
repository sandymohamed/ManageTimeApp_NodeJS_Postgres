import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getPrismaClient } from '../utils/database';
import { logger } from '../utils/logger';
import { JWTPayload, AuthenticationError, ValidationError } from '../types';

const SALT_ROUNDS = 12;

export interface SignupData {
  email: string;
  password: string;
  name: string;
  timezone?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  private static generateTokens(userId: string, email: string): AuthTokens {
    const accessToken = jwt.sign(
      { userId, email } as JWTPayload,
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }  as SignOptions
    );

    const refreshToken = jwt.sign(
      { userId, email, type: 'refresh' } as JWTPayload,
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' } as SignOptions
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  static async signup(data: SignupData): Promise<{ user: any; tokens: AuthTokens }> {
    const prisma = getPrismaClient();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ValidationError('User with this email already exists', 'email');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name,
        timezone: data.timezone || 'UTC',
        settings: {
          notifications: {
            email: true,
            push: true,
            inApp: true,
          },
          theme: 'system',
          language: 'en',
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    logger.info('User signed up successfully', { userId: user.id, email: user.email });

    return { user, tokens };
  }

  static async login(data: LoginData): Promise<{ user: any; tokens: AuthTokens }> {
    const prisma = getPrismaClient();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (!user) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValidPassword) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Clean up old refresh tokens (keep only last 5)
    const oldTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      skip: 4, // Keep 4 most recent + current
    });

    if (oldTokens.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: {
          id: { in: oldTokens.map(t => t.id) },
        },
      });
    }

    logger.info('User logged in successfully', { userId: user.id, email: user.email });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
        settings: user.settings,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  static async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const prisma = getPrismaClient();

    // Verify refresh token
    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as JWTPayload;
    } catch (error) {
      throw new AuthenticationError('Invalid refresh token');
    }

    // Check if token exists in database
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      // Clean up expired token
      if (tokenRecord) {
        await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      }
      throw new AuthenticationError('Refresh token expired');
    }

    // Generate new tokens
    const tokens = this.generateTokens(tokenRecord.user.id, tokenRecord.user.email);

    // Update refresh token in database
    await prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: {
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    logger.info('Tokens refreshed successfully', { userId: tokenRecord.user.id });

    return tokens;
  }

  static async logout(refreshToken?: string): Promise<void> {
    const prisma = getPrismaClient();

    // Remove refresh token from database if provided
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    }

    logger.info('User logged out successfully');
  }

  static async logoutAll(userId: string): Promise<void> {
    const prisma = getPrismaClient();

    // Remove all refresh tokens for user
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    logger.info('User logged out from all devices', { userId });
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const prisma = getPrismaClient();

    // Get user with password hash
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Logout from all devices
    await this.logoutAll(userId);

    logger.info('Password changed successfully', { userId });
  }

  static async requestPasswordReset(email: string): Promise<void> {
    const prisma = getPrismaClient();
    const { emailService } = await import('./emailService');

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      logger.warn('Password reset requested for non-existent email', { email });
      return; // Silent fail for security
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Generate reset token
    const resetToken = uuidv4();
    
    // Set expiration (10 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Delete any existing reset tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // Create new reset token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        email: user.email,
        otp,
        token: resetToken,
        expiresAt,
      },
    });

    // Send OTP email
    await emailService.sendPasswordResetOTP({
      email: user.email,
      otp,
      name: user.name || undefined,
    });

    logger.info('Password reset OTP sent', { userId: user.id, email });
  }

  static async verifyPasswordResetOTP(email: string, otp: string): Promise<string> {
    const prisma = getPrismaClient();

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      throw new AuthenticationError('Invalid OTP');
    }

    // Find valid reset token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        email,
        otp,
        expiresAt: { gt: new Date() },
        verified: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!resetToken) {
      throw new AuthenticationError('Invalid or expired OTP');
    }

    // Mark as verified
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { verified: true },
    });

    logger.info('Password reset OTP verified', { userId: user.id });

    // Return the reset token for password reset
    return resetToken.token;
  }

  static async resetPassword(token: string, newPassword: string): Promise<void> {
    const prisma = getPrismaClient();

    // Find valid reset token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || !resetToken.verified || resetToken.expiresAt < new Date()) {
      throw new AuthenticationError('Invalid or expired reset token');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newPasswordHash },
    });

    // Delete all reset tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: { userId: resetToken.userId },
    });

    // Logout from all devices
    await this.logoutAll(resetToken.userId);

    logger.info('Password reset successfully', { userId: resetToken.userId });
  }
}
