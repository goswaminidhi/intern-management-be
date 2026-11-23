import type { Request, Response } from 'express';
import * as passwordResetService from '../service/passwordResetService';

/** Safely read the message from anything thrown in a catch block. */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body as { email?: unknown };

    if (typeof email !== 'string' || !email.trim() || email.length > 254) {
      res.status(400).json({
        message: 'Please provide a valid email address.',
      });
      return;
    }

    await passwordResetService.requestPasswordReset(email);

    res.status(200).json({
      message: 'If an account exists for this email, an OTP will be sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', getErrorMessage(error));

    res.status(500).json({
      message: 'Unable to process your request. Please try again later.',
    });
  }
}

export async function verifyResetOTP(req: Request, res: Response): Promise<void> {
  try {
    const { email, otp } = req.body as { email?: unknown; otp?: unknown };

    const sanitizedOtp =
      typeof otp === 'number' ? String(otp) : typeof otp === 'string' ? otp.trim() : '';

    if (typeof email !== 'string' || !email.trim() || !/^\d{6}$/.test(sanitizedOtp)) {
      res.status(400).json({
        message: 'Please provide a valid email and 6-digit OTP.',
      });
      return;
    }

    const result = await passwordResetService.verifyResetOTP(email.trim(), sanitizedOtp);

    res.status(200).json({
      message: 'OTP verified successfully. You can now reset your password.',
      resetToken: result.resetToken,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    let statusCode = 500;
    let message = 'Unable to verify OTP. Please try again.';

    switch (errorMessage) {
      case 'INVALID_OTP':
        statusCode = 400;
        message = 'Invalid OTP or email.';
        break;

      case 'OTP_EXPIRED':
        statusCode = 400;
        message = 'Your OTP has expired. Please request a new one.';
        break;

      case 'OTP_ALREADY_VERIFIED':
        statusCode = 400;
        message = 'OTP already verified. Continue with password reset.';
        break;

      case 'TOO_MANY_ATTEMPTS':
        statusCode = 429;
        message = 'Too many incorrect attempts. Please request a new OTP.';
        break;
    }

    if (statusCode === 500) {
      console.error('Verify OTP error:', errorMessage);
    }

    res.status(statusCode).json({ code: errorMessage, message });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body as {
      resetToken?: unknown;
      newPassword?: unknown;
      confirmPassword?: unknown;
    };

    if (
      typeof resetToken !== 'string' ||
      !resetToken.trim() ||
      typeof newPassword !== 'string' ||
      typeof confirmPassword !== 'string'
    ) {
      res.status(400).json({
        message: 'Please provide all required fields.',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      res.status(400).json({
        message: 'Passwords do not match.',
      });
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 72) {
      res.status(400).json({
        message: 'Password must be between 8 and 72 characters.',
      });
      return;
    }

    const result = await passwordResetService.resetPassword(resetToken.trim(), newPassword);

    res.status(200).json(result);
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    if (errorMessage === 'INVALID_RESET_TOKEN' || errorMessage === 'RESET_TOKEN_EXPIRED') {
      res.status(400).json({
        code: errorMessage,
        message: 'Invalid or expired reset token. Please verify your email again.',
      });
      return;
    }

    if (errorMessage === 'USER_NOT_FOUND') {
      res.status(404).json({
        code: errorMessage,
        message: 'User not found.',
      });
      return;
    }
    if (errorMessage === 'New password cannot be the same as the old password') {
      res.status(400).json({
        code: 'SAME_PASSWORD',
        message: 'New password cannot be the same as your old password.',
      });
      return;
    }
    console.error('Password reset error:', errorMessage);

    res.status(500).json({
      message: 'Unable to reset password. Please try again later.',
    });
  }
}