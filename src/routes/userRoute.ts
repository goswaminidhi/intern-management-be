import { Router } from 'express';

import userController from '../controllers/userController';
import { verifyToken, authorize } from '../middleware/authMiddleware';
import { checkFirstLogin } from '../middleware/firstLoginCheckMiddleware';
import { validate } from '../middleware/validate';
import {
  createUserSchema,
  updateUserSchema,
  assignMentorSchema,
  getUserSchema,
  loginSchema,
  changePasswordSchema,
  getAllUsersSchema,
} from '../schemas/userSchema';

import { updatePassword } from "../controllers/userController";
import { getHierarchy } from "../controllers/hierarchyController";

const router = Router();

// User Login (generates access token + sets httpOnly refresh cookie)
router.post('/users/login', validate(loginSchema), userController.login);

// Refresh access token using httpOnly refresh cookie (rotates refresh token)
router.post('/users/refresh', userController.refresh);

// Logout current device (revokes cookie refresh token & clears cookie)
router.post('/users/logout', userController.logout);

// Logout from all devices (authenticated)
router.post('/users/logout-all', verifyToken, userController.logoutAll);

// Current user profile (accessible before first-login password change completes)
router.get('/users/me', verifyToken, userController.getMe);

// Complete first login (authenticated user themselves or admin)
// router.patch(
//   '/users/:id/complete-first-login',
//   verifyToken,
//   validate(getUserSchema),
//   userController.completeFirstLogin
// );

// Change password (accessible before first-login gate completes)
router.patch(
  '/users/changepassword',
  verifyToken,
  validate(changePasswordSchema),
  userController.changePassword
);

// Create a user (Admin only)
router.post(
  '/users',
  verifyToken,
  checkFirstLogin,
  authorize('admin'),
  validate(createUserSchema),
  userController.createUser
);

// Get all users and filtration (Admin & scoped Mentor only)
router.get(
  '/users',
  verifyToken,
  checkFirstLogin,
  authorize('admin', 'mentor'),
  validate(getAllUsersSchema),
  userController.getAllUsers
);

// Update user (Admin only)
router.patch(
  '/users/update/:id',
  verifyToken,
  checkFirstLogin,
  authorize('admin'),
  validate(updateUserSchema),
  userController.updateUser
);

// Assign, change, or remove a mentor for a mentee (Admin only)
router.patch(
  '/users/:id/assign-mentor',
  verifyToken,
  checkFirstLogin,
  authorize('admin'),
  validate(assignMentorSchema),
  userController.assignMentor
);

// Delete user (Admin only - Mentors are not permitted to delete mentees)
router.delete(
  '/users/delete/:id',
  verifyToken,
  checkFirstLogin,
  authorize('admin'),
  validate(getUserSchema),  
  userController.deleteUser
);

router.patch("/users/update-password", verifyToken, updatePassword);

// Get full hierarchy: Admin -> Mentors -> Mentees (Admin only)
router.get(
  '/users/hierarchy',
  verifyToken,
  checkFirstLogin,
  authorize('admin'),
  getHierarchy
);

export default router;