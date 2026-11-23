import { Router } from 'express';

import {
  raiseTaskBlocker,
  listTaskBlockers,
  getTaskBlockerById,
  getTaskBlockerConversation,
  getTaskBlockerMessages,
  sendTaskBlockerMessage,
  resolveTaskBlocker,
} from '../controllers/taskBlockerController';

import { authenticate, authorize } from '../middleware/authMiddleware';

const router = Router();

// Every blocker route requires a logged-in user
router.use(authenticate);

// List blockers (mentee: own, mentor: assigned, admin: all)
router.get('/', listTaskBlockers);

// Raise a blocker: mentees only
router.post('/', authorize('mentee'), raiseTaskBlocker);
router.post('/tasks/:taskId', authorize('mentee'), raiseTaskBlocker);

// Latest conversation for a task
router.get('/tasks/:taskId', getTaskBlockerConversation);

// Messages
router.get('/:conversationId/messages', getTaskBlockerMessages);
router.post(
  '/:conversationId/messages',
  authorize('mentee', 'mentor'),
  sendTaskBlockerMessage
);

// Resolve: mentees only (a mentor gets 403 here)
router.patch('/:conversationId/resolve', authorize('mentee'), resolveTaskBlocker);

// One conversation with details and messages (keep this LAST)
router.get('/:conversationId', getTaskBlockerById);

export default router;