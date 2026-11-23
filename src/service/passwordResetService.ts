import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { Op } from 'sequelize';

import { sequelize } from '../config/database';
import User from '../models/user';
import PasswordReset from '../models/resetPassword';
import { sendPasswordResetOTP } from './emailService';
import { revokeAllForUser } from './tokenService';

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashOTP(otp: string | number): string {
  const secret = process.env.RESET_OTP_SECRET;

  if (!secret) {
    throw new Error('RESET_OTP_SECRET is not configured');
  }

  return crypto.createHmac('sha256', secret).update(String(otp)).digest('hex');
}

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({
    where: { email: normalizedEmail },
  });

  // Keep the response the same whether the email exists or not.
  if (!user) {
    return;
  }

  const otp = crypto.randomInt(100000, 1000000).toString();

  // Invalidate any previous reset requests for this user.
  await PasswordReset.destroy({
    where: { userId: user.id },
  });

  const resetRequest = await PasswordReset.create({
    userId: user.id,
    otpHash: hashOTP(otp),
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
  });

  try {
    await sendPasswordResetOTP(user, otp);
  } catch (error) {
    // Don't leave an active OTP when email delivery fails.
    await PasswordReset.destroy({
      where: { id: resetRequest.id },
    });

    throw error;
  }
}

export async function verifyResetOTP(
  email: string,
  submittedOTP: string
): Promise<{ resetToken: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new Error('INVALID_OTP');
  }

  const resetRequest = await PasswordReset.findOne({
    where: { userId: user.id },
    order: [['createdAt', 'DESC']],
  });

  if (!resetRequest || resetRequest.usedAt) {
    throw new Error('INVALID_OTP');
  }

  if (resetRequest.expiresAt.getTime() <= Date.now()) {
    await resetRequest.destroy();
    throw new Error('OTP_EXPIRED');
  }

  if (resetRequest.verifiedAt) {
    throw new Error('OTP_ALREADY_VERIFIED');
  }

  if (resetRequest.attempts >= MAX_ATTEMPTS) {
    await resetRequest.destroy();
    throw new Error('TOO_MANY_ATTEMPTS');
  }

  const submittedHash = hashOTP(submittedOTP);
  const storedHash = resetRequest.otpHash;
  const isMatch =
    submittedHash.length === storedHash.length &&
    crypto.timingSafeEqual(Buffer.from(submittedHash, 'hex'), Buffer.from(storedHash, 'hex'));

  if (!isMatch) {
    resetRequest.attempts += 1;
    await resetRequest.save();

    if (resetRequest.attempts >= MAX_ATTEMPTS) {
      await resetRequest.destroy();
      throw new Error('TOO_MANY_ATTEMPTS');
    }

    throw new Error('INVALID_OTP');
  }

  const resetToken = crypto.randomBytes(32).toString('hex');

  resetRequest.verifiedAt = new Date();
  resetRequest.resetTokenHash = hashResetToken(resetToken);
  resetRequest.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await resetRequest.save();

  return { resetToken };
}

export async function resetPassword(
  resetToken: string,
  newPassword: string
): Promise<{ message: string }> {
  const resetTokenHash = hashResetToken(resetToken);

  const transaction = await sequelize.transaction();

  try {
    const resetRequest = await PasswordReset.findOne({
      where: {
        resetTokenHash,
        verifiedAt: {
          [Op.ne]: null,
        },
        usedAt: null,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!resetRequest) {
      throw new Error('INVALID_RESET_TOKEN');
    }

    if (
      !resetRequest.resetTokenExpiresAt ||
      resetRequest.resetTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new Error('RESET_TOKEN_EXPIRED');
    }

    const user = await User.unscoped().findByPk(resetRequest.userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    // Validate that the new password is not the same as the old password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new Error('New password cannot be the same as the old password');
    }

    // Hash the new password before saving it.
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    user.password = hashedPassword;
    user.firstLogin = false; // Successfully resetting password clears firstLogin flag
    await user.save({ transaction });

    // Consume the reset token so it cannot be reused.
    resetRequest.usedAt = new Date();
    resetRequest.resetTokenHash = null;
    resetRequest.resetTokenExpiresAt = null;

    await resetRequest.save({ transaction });

    await transaction.commit();

    // Revoke all active refresh token sessions after a password reset
    await revokeAllForUser(user.id);

    return { message: 'Password reset successfully' };
  } catch (error) {
  await transaction.rollback();
  throw error;
  }
}