import { Router } from 'express';
import { verifyToken, authorize } from '../middleware/authMiddleware';
import { checkFirstLogin } from '../middleware/firstLoginCheckMiddleware';
import { validate } from '../middleware/validate';
import { uploadTaskAttachments } from '../middleware/taskUpload';
import {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  submitTaskSchema,
  evaluateTaskSchema,
  taskIdParamSchema,
  listTasksQuerySchema,
} from '../schemas/taskSchema';

import {
  createTaskController,
  getAllTasksController,
  getTaskByIdController,
  updateTaskController,
  updateTaskStatusController,
  submitTaskController,
  evaluateTaskController,
  deleteTaskController,
  downloadTaskAttachmentController,
} from '../controllers/taskController';

import {
  startTimerController,
  stopTimerController,
  getTaskTimeController,
  getActiveTimerController
} from '../controllers/timeLogController';

const router = Router();

// All task routes require authentication and completed first login
router.use(verifyToken, checkFirstLogin);

// Create a new task (Admin & Mentor only)
router.post(
  '/',
  authorize('admin', 'mentor'),
  uploadTaskAttachments,
  validate(createTaskSchema),
  createTaskController
);

// Get all tasks (role-scoped)
router.get('/', validate(listTasksQuerySchema), getAllTasksController);

// Time tracking active timer (placed before /:id so it is never matched as a param)
router.get('/time/active', authorize('mentee'), getActiveTimerController);

// Get a particular task (role-scoped)
router.get('/:id', validate(taskIdParamSchema), getTaskByIdController);

// Update a task (Admin & owning Mentor only)
router.patch(
  '/:id',
  authorize('admin', 'mentor'),
  validate(updateTaskSchema),
  updateTaskController
);

router.get('/:id/attachments/:attachmentId/download', downloadTaskAttachmentController);

// Update task status (Assigned Mentee, Admin & owning Mentor)
router.patch(
  '/:id/status',
  authorize('admin', 'mentor', 'mentee'),
  validate(updateTaskStatusSchema),
  updateTaskStatusController
);
// Time tracking

router.post(
  '/:id/time/start',
  authorize('mentee'),
  validate(taskIdParamSchema),
  startTimerController
);

router.post(
  '/:id/time/stop',
  authorize('mentee'),
  validate(taskIdParamSchema),
  stopTimerController
);

router.get(
  '/:id/time',
  authorize('admin', 'mentor', 'mentee'),
  validate(taskIdParamSchema),
  getTaskTimeController
);

// Submit task work (Assigned Mentee only)
router.patch(
  '/:id/submit',
  authorize('mentee'),
  validate(submitTaskSchema),
  submitTaskController
);

// Evaluate task submission (Admin & owning Mentor only)
router.patch(
  '/:id/evaluate',
  authorize('admin', 'mentor'),
  validate(evaluateTaskSchema),
  evaluateTaskController
);

// Delete a task (Admin & owning Mentor only)
router.delete(
  '/:id',
  authorize('admin', 'mentor'),
  validate(taskIdParamSchema),
  deleteTaskController
);

export default router;
