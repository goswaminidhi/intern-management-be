import type { Request, Response } from 'express';
import { z } from 'zod';
import * as chat from '../service/chatService';
import { ChatError } from '../service/chatService';
import { fetchAndDecryptFromImageKit } from '../service/imageKitService';

// ---------- Validation ----------
const idSchema = z.coerce.number().int().positive();

const renameGroupBody = z.object({
  name: z.string().trim().min(2, 'Group name is too short').max(120),
});

const createGroupBody = z.object({
  name: z.string().trim().min(2, 'Group name is too short').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  memberIds: z.array(z.number().int().positive()).min(1, 'Select members').max(200),
  taskId: z.number().int().positive().optional().nullable(),
});

const memberIdsBody = z.object({
  userIds: z.array(z.number().int().positive()).min(1).max(200),
});

const messageQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// ---------- Helpers ----------
const actorOf = (req: Request): chat.Actor => {
  if (!req.user) throw new ChatError('Authentication required', 401);
  return req.user;
};

type Handler = (req: Request, res: Response) => Promise<void>;

/** One place that turns thrown errors into JSON responses. */
const wrap =
  (fn: Handler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ChatError) {
        res.status(err.statusCode).json({ success: false, message: err.message });
        return;
      }
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, message: err.issues[0]?.message ?? 'Invalid request' });
        return;
      }
      console.error('Chat error:', err);
      res.status(500).json({ success: false, message: 'Something went wrong.' });
    }
  };

// ---------- Handlers ----------
const chatController = {
  listGroups: wrap(async (req, res) => {
    const actor = actorOf(req);
    const data =
      req.query.scope === 'all' ? await chat.listAllGroups(actor) : await chat.listGroups(actor);
    res.json({ success: true, data });
  }),

  getGroup: wrap(async (req, res) => {
    const data = await chat.getGroupDetail(actorOf(req), idSchema.parse(req.params.groupId));
    res.json({ success: true, data });
  }),

  createGroup: wrap(async (req, res) => {
    const body = createGroupBody.parse(req.body);
    const data = await chat.createGroup(actorOf(req), body);
    res.status(201).json({ success: true, data });
  }),

  renameGroup: wrap(async (req, res) => {
    const { name } = renameGroupBody.parse(req.body);
    const data = await chat.renameGroup(
      actorOf(req),
      idSchema.parse(req.params.groupId),
      name
    );
    res.json({ success: true, data });
  }),

  deleteGroup: wrap(async (req, res) => {
    const data = await chat.deleteGroup(
      actorOf(req),
      idSchema.parse(req.params.groupId)
    );
    res.json({ success: true, message: 'Group deleted successfully', data });
  }),

  addMembers: wrap(async (req, res) => {
    const { userIds } = memberIdsBody.parse(req.body);
    const data = await chat.addMembers(actorOf(req), idSchema.parse(req.params.groupId), userIds);
    res.json({ success: true, data });
  }),

  removeMember: wrap(async (req, res) => {
    const data = await chat.removeMember(
      actorOf(req),
      idSchema.parse(req.params.groupId),
      idSchema.parse(req.params.userId)
    );
    res.json({ success: true, data });
  }),

  archiveGroup: wrap(async (req, res) => {
    const data = await chat.archiveGroup(actorOf(req), idSchema.parse(req.params.groupId));
    res.json({ success: true, data });
  }),

  getMessages: wrap(async (req, res) => {
    const query = messageQuery.parse(req.query);
    const data = await chat.getMessages(actorOf(req), idSchema.parse(req.params.groupId), query);
    res.json({ success: true, data });
  }),

  sendMessage: wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      const data = await chat.sendMessage(actorOf(req), idSchema.parse(req.params.groupId), {
        body,
        files,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      await chat.cleanupUploadedFiles(files); // don't leave orphan files if the message failed
      throw err;
    }
  }),

  deleteMessage: wrap(async (req, res) => {
    const data = await chat.deleteMessage(
      actorOf(req),
      idSchema.parse(req.params.groupId),
      idSchema.parse(req.params.messageId)
    );
    res.json({ success: true, data });
  }),

  markRead: wrap(async (req, res) => {
    const { messageId } = z.object({ messageId: z.number().int().positive() }).parse(req.body);
    await chat.markRead(actorOf(req), idSchema.parse(req.params.groupId), messageId);
    res.json({ success: true });
  }),

  /** Files are only reachable through this authenticated route. */
  downloadAttachment: wrap(async (req, res) => {
    const { filePath, url, mimeType, originalName } = await chat.getAttachmentFile(
      actorOf(req),
      idSchema.parse(req.params.attachmentId)
    );
    // If file is hosted on ImageKit, fetch ciphertext, decrypt it, and stream to client
    if (url) {
      const decryptedBuffer = await fetchAndDecryptFromImageKit(url);
      const inline = mimeType.startsWith('image/');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', decryptedBuffer.length);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(originalName)}`
      );
      res.send(decryptedBuffer);
      return;
    }
    // Fallback for legacy files stored on local server disk
    if (filePath) {
      const inline = mimeType.startsWith('image/');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(originalName)}`
      );
      res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ success: false, message: 'File not found' });
        }
      });
      return;
    }
    res.status(404).json({ success: false, message: 'File not found' });
  }),
};

export default chatController;