// // Alias for backwards compatibility
// export const requirePasswordChangeIfFirstLogin = checkFirstLogin;

import type { Request, Response, NextFunction } from 'express';
import User from '../models/user';

/**
 * Middleware to check whether the authenticated user
 * has firstLogin set to true.
 *
 * If true, the user must change their password.
 * Otherwise, the request continues.
 */
export const checkFirstLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Use the already-loaded user if available.
    let user: User | null = req.currentUser ?? null;

    // If the user is not loaded, fetch them using the authenticated user ID.
    if (!user) {
      const userId = req.user?.id;

      if (
        typeof userId !== 'string' &&
        typeof userId !== 'number'
      ) {
        res.status(401).json({
          success: false,
          message: 'Authentication required. Please provide a valid token.',
        });
        return;
      }

      user = await User.findByPk(userId);
    }

    // Check whether the user exists.
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found.',
      });
      return;
    }

    // Store the fetched user in the request.
    req.currentUser = user;

    // Check whether the user is logging in for the first time.
    if (user.firstLogin === true) {

      // For normal browser navigation requests.
      if (req.accepts('html') && !req.accepts('json') && !req.xhr) {
        res.redirect('/changePassword');
        return;
      }

      // For API, AJAX, and Fetch requests.
      res.status(403).json({
        success: false,
        code: 'FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED',
        firstLogin: true,
        redirectTo: '/changePassword',
        message:
          'First login detected. Please change your password to continue.',
      });

      return;
    }

    // If firstLogin is false, allow the request.
    next();

  } catch (error) {
    console.error('First login check middleware error:', error);
    next(error);
  }
};

// Alias for backward compatibility.
export const requirePasswordChangeIfFirstLogin = checkFirstLogin;