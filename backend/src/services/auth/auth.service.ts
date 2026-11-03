import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { getRedisClient } from '../../config/redis.js';
import { AppError } from '../../utils/appError.js';
import { logger } from '../../utils/logger.js';
import {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ResendVerificationInput,
} from '../../validators/auth.validator.js';
import { Role, DriverStatus } from '@prisma/client';

export class AuthService {
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  public async register(input: RegisterInput) {
    const normalizedEmail = input.email.toLowerCase().trim();
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: input.phone }],
      },
    });

    if (existing) {
      if (existing.email === normalizedEmail) {
        throw new AppError('An account with this email address already exists', 409, 'EMAIL_EXISTS');
      }
      throw new AppError('An account with this phone number already exists', 409, 'PHONE_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email: normalizedEmail,
        phone: input.phone.trim(),
        passwordHash,
        role: input.role as Role,
      },
    });

    let driverId: string | null = null;
    if (input.role === 'DRIVER') {
      const driver = await prisma.driver.create({
        data: {
          userId: user.id,
          status: DriverStatus.OFFLINE,
          rating: 5.0,
          vehicle: {
            create: {
              vehicleType: 'SEDAN',
              model: input.vehicle?.model?.trim() || input.vehicleModel?.trim() || 'Maruti Suzuki Dzire',
              numberPlate: input.vehicle?.numberPlate?.trim() || input.numberPlate?.trim() || `WB-02-REG-${Math.floor(1000 + Math.random() * 9000)}`,
            },
          },
        },
      });
      driverId = driver.id;
    }

    // Generate email verification token (valid for 24 hours)
    const rawVerifyToken = crypto.randomBytes(32).toString('hex');
    const verifyHash = this.hashToken(rawVerifyToken);
    try {
      const redis = getRedisClient();
      await redis.set(
        `auth:verify:${verifyHash}`,
        JSON.stringify({ userId: user.id, email: user.email }),
        'EX',
        86400
      );
    } catch {
      logger.warn('Redis unavailable; email verification token persistence deferred');
    }

    const token = this.generateToken(user.id, user.email, user.role, '7d');
    const isDev = env.NODE_ENV !== 'production';

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        driverId,
        isEmailVerified: false,
      },
      token,
      emailServiceConfigured: false,
      ...(isDev ? { devVerificationToken: rawVerifyToken } : {}),
    };
  }

  public async login(input: LoginInput) {
    const normalizedEmail = input.email.toLowerCase().trim();

    if (env.NODE_ENV === 'production' && normalizedEmail.endsWith('@miro.local')) {
      throw new AppError('Demo accounts are disabled in production', 403, 'DEMO_DISABLED');
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { driver: true },
    });

    if (!user) {
      // Run dummy bcrypt comparison to protect against timing attacks & enumeration
      await bcrypt.compare(input.password, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012');
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isEmailVerified = await this.isEmailVerified(user.id, user.email);
    const expiresIn = input.rememberMe ? '7d' : '24h';
    const token = this.generateToken(user.id, user.email, user.role, expiresIn);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        driverId: user.driver?.id || null,
        isEmailVerified,
      },
      token,
    };
  }

  public async forgotPassword(input: ForgotPasswordInput) {
    const normalizedEmail = input.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    let rawResetToken: string | null = null;
    if (user) {
      rawResetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawResetToken);
      try {
        const redis = getRedisClient();
        await redis.set(
          `auth:reset:${tokenHash}`,
          JSON.stringify({ userId: user.id, email: user.email, createdAt: Date.now() }),
          'EX',
          3600 // 1 hour
        );
      } catch {
        logger.warn('Redis unavailable; password reset token persistence deferred');
      }
    }

    const isDev = env.NODE_ENV !== 'production';
    return {
      success: true,
      message: 'If an account matches that email, password reset instructions have been sent.',
      emailServiceConfigured: false,
      ...(isDev && rawResetToken ? { devResetToken: rawResetToken } : {}),
    };
  }

  public async resetPassword(input: ResetPasswordInput) {
    const tokenHash = this.hashToken(input.token.trim());
    const redis = getRedisClient();

    let rawData: string | null = null;
    try {
      rawData = await redis.get(`auth:reset:${tokenHash}`);
    } catch {
      throw new AppError('Verification store temporarily unavailable', 503, 'CACHE_UNAVAILABLE');
    }

    if (!rawData) {
      throw new AppError('Password reset token is invalid or has expired', 400, 'INVALID_RESET_TOKEN');
    }

    const record = JSON.parse(rawData) as { userId: string; email: string };

    // Enforce single-use validation by deleting token immediately
    try {
      await redis.del(`auth:reset:${tokenHash}`);
    } catch {}

    const passwordHash = await bcrypt.hash(input.password, 10);
    await prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });

    return {
      success: true,
      message: 'Password has been reset successfully. Please sign in with your new password.',
    };
  }

  public async verifyEmail(input: VerifyEmailInput) {
    const tokenHash = this.hashToken(input.token.trim());
    const redis = getRedisClient();

    let rawData: string | null = null;
    try {
      rawData = await redis.get(`auth:verify:${tokenHash}`);
    } catch {
      throw new AppError('Verification store temporarily unavailable', 503, 'CACHE_UNAVAILABLE');
    }

    if (!rawData) {
      throw new AppError('Email verification link is invalid or has expired', 400, 'INVALID_VERIFICATION_TOKEN');
    }

    const record = JSON.parse(rawData) as { userId: string; email: string };

    try {
      await redis.del(`auth:verify:${tokenHash}`);
      await redis.set(`auth:verified:${record.userId}`, 'true');
    } catch {}

    return {
      success: true,
      message: 'Email address has been successfully verified.',
      email: record.email,
    };
  }

  public async resendVerification(input: ResendVerificationInput) {
    const normalizedEmail = input.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    let rawToken: string | null = null;
    if (user) {
      rawToken = crypto.randomBytes(32).toString('hex');
      const verifyHash = this.hashToken(rawToken);
      try {
        const redis = getRedisClient();
        await redis.set(
          `auth:verify:${verifyHash}`,
          JSON.stringify({ userId: user.id, email: user.email }),
          'EX',
          86400
        );
      } catch {}
    }

    const isDev = env.NODE_ENV !== 'production';
    return {
      success: true,
      message: 'If an account matches that email, a verification link has been generated.',
      emailServiceConfigured: false,
      ...(isDev && rawToken ? { devVerificationToken: rawToken } : {}),
    };
  }

  public async isEmailVerified(userId: string, email?: string): Promise<boolean> {
    if (email && email.toLowerCase().endsWith('@miro.local')) return true;
    try {
      const redis = getRedisClient();
      const verified = await redis.get(`auth:verified:${userId}`);
      return verified === 'true';
    } catch {
      return false;
    }
  }

  public generateToken(userId: string, email: string, role: string, expiresIn: string | number = '7d'): string {
    const options: SignOptions = {
      expiresIn: expiresIn as SignOptions['expiresIn'],
    };
    return jwt.sign({ userId, email, role }, env.JWT_SECRET, options);
  }

  public verifyToken(token: string): { userId: string; email: string; role: Role } {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as {
        userId: string;
        email: string;
        role: Role;
      };
      return decoded;
    } catch {
      throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
    }
  }
}

export const authService = new AuthService();
