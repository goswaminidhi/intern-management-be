import { z } from 'zod';

const emailField = z.email('Please enter a valid email address').trim().toLowerCase();

// 1. Request OTP / Forgot Password
export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailField,
  }),
});

// 2. Verify OTP
export const verifyOtpSchema = z.object({
  body: z.object({
    email: emailField,
    otp: z.string().regex(/^\d{6}$/, 'OTP must contain exactly 6 digits'),
  }),
});

// 3. Reset Password
export const resetPasswordSchema = z
  .object({
    body: z.object({
      resetToken: z.string().min(1, 'Reset token is required'),
      newPassword: z
        .string()
        .min(8, 'Password must contain at least 8 characters')
        .max(72, 'Password must be at most 72 characters'),
      confirmPassword: z.string().min(1, 'Please confirm your password'),
    }),
  })
  .refine((data) => data.body.newPassword === data.body.confirmPassword, {
    message: 'Passwords do not match',
    path: ['body', 'confirmPassword'],
  });

export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>['body'];
export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>['body'];
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>['body'];