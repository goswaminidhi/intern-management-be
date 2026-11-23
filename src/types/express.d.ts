import 'express';
import type User from '../models/user';
import type { UserRole, UserStatus } from '../models/user';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        name: string;
        email: string;
        role: UserRole;
        status: UserStatus;
        firstLogin: boolean;
        mentor_id: number | null;
        assigned_to: string | null;
        assignedMentees: number[];
      };

      currentUser?: User;
      validatedQuery?: Record<string, unknown>;
    }
  }
}

export {};