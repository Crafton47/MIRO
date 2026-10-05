import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/appError.js';
import { RegisterInput, LoginInput } from '../../validators/auth.validator.js';

import { Role } from '@prisma/client';

export class AuthService {
  public async register(input: RegisterInput) {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { phone: input.phone }] },
    });

    if (existing) {
      throw new AppError('User with this email or phone already exists', 400, 'USER_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
        role: input.role as Role,
      },
    });

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
      token,
    };
  }

  public async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { driver: true },
    });

    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        driverId: user.driver?.id || null,
      },
      token,
    };
  }

  public generateToken(userId: string, email: string, role: string): string {
    return jwt.sign({ userId, email, role }, env.JWT_SECRET, { expiresIn: '7d' });
  }

  public verifyToken(token: string): { userId: string; email: string; role: Role } {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; email: string; role: Role };
      return decoded;
    } catch {
      throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
    }
  }
}

export const authService = new AuthService();
