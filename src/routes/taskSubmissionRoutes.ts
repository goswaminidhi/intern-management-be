import { Router } from 'express';

import {
  submitTask,
  requestChanges,
  approveSubmission,
  getSubmissionHistory,
  getSubmissionById,
  downloadSubmissionAttachment,
} from '../controllers/taskSubmissionController';

import {
  authenticate,
  authorize
} from '../middleware/authMiddleware';
import { uploadSubmissionAttachment } from '../middleware/taskUpload';

const router = Router();

// Mentee submits or resubmits a task.
router.post(
  '/tasks/:taskId/submit',
  authenticate,
  authorize('mentee'),
  uploadSubmissionAttachment,
  submitTask
);

// Get all versions of a task.
router.get(
  '/tasks/:taskId/submissions',
  authenticate,
  getSubmissionHistory
);

// Get an individual submission.
router.get(
  '/submissions/:submissionId',
  authenticate,
  getSubmissionById
);

// Mentor requests changes.
router.patch(
  '/submissions/:submissionId/request-changes',
  authenticate,
  authorize('mentor'),
  requestChanges
);

// Mentor approves a submission.
router.patch(
  '/submissions/:submissionId/approve',
  authenticate,
  authorize('mentor'),
  approveSubmission
);

router.get(
  '/submissions/:submissionId/attachment',
  authenticate,
  downloadSubmissionAttachment
);

export default router;