import { Router } from 'express';
import chatController from '../controllers/chatController';
import { verifyToken, authorize } from '../middleware/authMiddleware';
import { ensureCanPost, uploadFiles } from '../middleware/chatUpload';
// If your other routes use firstLoginCheckMiddleware, add it here the same way
// (e.g. router.use(verifyToken, firstLoginCheck)).

const router = Router();

router.use(verifyToken);

// ---- Groups ----
router.get('/groups', chatController.listGroups); // ?scope=all => admin management list
router.post('/groups', authorize('admin', 'mentor'), chatController.createGroup);
router.get('/groups/:groupId', chatController.getGroup);
router.post('/groups/:groupId/members', authorize('admin', 'mentor'), chatController.addMembers);
router.delete(
  '/groups/:groupId/members/:userId',
  authorize('admin', 'mentor'),
  chatController.removeMember
);
router.post('/groups/:groupId/archive', authorize('admin', 'mentor'), chatController.archiveGroup);

// ---- Messages ----
router.get('/groups/:groupId/messages', chatController.getMessages);
router.patch('/groups/:groupId', authorize('admin', 'mentor'), chatController.renameGroup);
router.delete('/groups/:groupId', authorize('admin'), chatController.deleteGroup);
// Order matters: membership check -> upload -> controller
router.post('/groups/:groupId/messages', ensureCanPost, uploadFiles, chatController.sendMessage);
router.delete('/groups/:groupId/messages/:messageId', chatController.deleteMessage);
router.post('/groups/:groupId/read', chatController.markRead);

// ---- Files (authenticated download, never served statically) ----
router.get('/attachments/:attachmentId', chatController.downloadAttachment);

export default router;