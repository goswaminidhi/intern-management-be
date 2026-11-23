import crypto from 'crypto';
import { Op } from 'sequelize';
import type { Request, Response, CookieOptions } from 'express';
import RefreshToken from '../models/refreshToken';
 
/** Base name — the actual cookie is `refreshToken_<userId>`. */
export const REFRESH_COOKIE_BASE = 'refreshToken';

/** Build the per-user cookie name so each login gets its own cookie. */
export function refreshCookieName(userId: number | string): string {
  return `${REFRESH_COOKIE_BASE}_${userId}`;
}
export const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 7;
export const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
 
/** If a just-rotated token is replayed within this window (e.g. two tabs
 *  refreshing at once) we reject it but do NOT revoke the whole family. */
const REUSE_GRACE_MS = 10_000;
 
export class RefreshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshTokenError';
  }
}
 
export const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');
 
const generateRawToken = (): string => crypto.randomBytes(48).toString('hex');
 
// ---------- Cookie helpers ----------
 
function cookieOptions(): CookieOptions {
  const sameSite = (process.env.COOKIE_SAMESITE as 'strict' | 'lax' | 'none') || 'strict';
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    // Must be a prefix of your refresh + logout routes, e.g. '/api'
    path: process.env.REFRESH_COOKIE_PATH || '/api',
  };
}
 
export function setRefreshCookie(res: Response, rawToken: string, userId: number | string): void {
  res.cookie(refreshCookieName(userId), rawToken, {
    ...cookieOptions(),
    maxAge: REFRESH_TTL_MS,
  });
}
 
export function clearRefreshCookie(res: Response, userId: number | string): void {
  res.clearCookie(refreshCookieName(userId), cookieOptions());
}

/** Clear every `refreshToken_*` cookie found in the request (used for logout-all). */
export function clearAllRefreshCookies(req: Request, res: Response): void {
  if (req.cookies) {
    for (const name of Object.keys(req.cookies)) {
      if (name.startsWith(`${REFRESH_COOKIE_BASE}_`)) {
        res.clearCookie(name, cookieOptions());
      }
    }
  }
}
 
// ---------- Token lifecycle ----------
 
/** Create a refresh token. Omit familyId on login to start a new family. */
export async function createRefreshToken(
  userId: number,
  familyId: string = crypto.randomUUID()
): Promise<string> {
  const raw = generateRawToken();
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(raw),
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return raw;
}
 
/**
 * Validate the presented refresh token, revoke it, and issue a replacement
 * in the same family. Throws RefreshTokenError if invalid.
 */
export async function rotateRefreshToken(
  rawToken: string
): Promise<{ userId: number; newToken: string }> {
  const record = await RefreshToken.findOne({
    where: { tokenHash: hashToken(rawToken) },
  });
 
  if (!record) throw new RefreshTokenError('Invalid refresh token');
 
  if (record.revokedAt) {
    const withinGrace = Date.now() - record.revokedAt.getTime() < REUSE_GRACE_MS;
    if (withinGrace) {
      // Concurrent request already rotated this token within the grace window.
      // Return the active replacement token for this family instead of revoking it.
      const activeRecord = await RefreshToken.findOne({
        where: { familyId: record.familyId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
        order: [['createdAt', 'DESC']],
      });
      if (activeRecord) {
        const replacementToken = await createRefreshToken(record.userId, record.familyId);
        return { userId: record.userId, newToken: replacementToken };
      }
    } else {
      // Old token replayed after grace window -> likely stolen. Kill the whole session family.
      await RefreshToken.update(
        { revokedAt: new Date() },
        { where: { familyId: record.familyId, revokedAt: null } }
      );
    }
    throw new RefreshTokenError('Refresh token has been revoked');
  }
 
  if (record.expiresAt.getTime() < Date.now()) {
    throw new RefreshTokenError('Refresh token has expired');
  }
 
  // Conditional update so two concurrent requests can't both rotate the same token
  const [affected] = await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { id: record.id, revokedAt: null } }
  );
  if (affected === 0) throw new RefreshTokenError('Refresh token has been revoked');
 
  const newToken = await createRefreshToken(record.userId, record.familyId);
  return { userId: record.userId, newToken };
}
 
/** Revoke a single token (logout on this device). */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { tokenHash: hashToken(rawToken), revokedAt: null } }
  );
}
 
/** Revoke every session for a user (password change, logout everywhere, deactivation). */
export async function revokeAllForUser(userId: number): Promise<void> {
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null } }
  );
}
 
/** Housekeeping: call from a cron / setInterval once a day. */
export async function deleteExpiredTokens(): Promise<number> {
  return RefreshToken.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
}
 
