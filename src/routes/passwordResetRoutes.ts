import { Router } from 'express';

import {
  forgotPassword,
  verifyResetOTP,
  resetPassword,
} from '../controllers/passwordResetController';
import { validate } from '../middleware/validate';
import {
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} from '../schemas/resetPasswordSchema';

const router = Router();

router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/verify-reset-otp', validate(verifyOtpSchema), verifyResetOTP);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

export default router;