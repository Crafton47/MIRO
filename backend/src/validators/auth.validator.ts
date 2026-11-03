import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address').transform((v) => v.toLowerCase().trim()),
  phone: z.string().min(10, 'Phone must be at least 10 digits').max(20),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['RIDER', 'DRIVER']).default('RIDER'),
  termsAccepted: z.boolean().optional().default(true),
  vehicleModel: z.string().max(50).optional(),
  numberPlate: z.string().max(30).optional(),
  vehicle: z.object({
    model: z.string().max(50).optional(),
    numberPlate: z.string().max(30).optional(),
  }).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address').transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').transform((v) => v.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(8, 'Reset token is required'),
  password: z.string().min(8, 'New password must be at least 8 characters'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(8, 'Verification token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address').transform((v) => v.toLowerCase().trim()),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
