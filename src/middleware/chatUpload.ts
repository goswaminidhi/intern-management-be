import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { assertCanPost, ChatError } from '../service/chatService';

// Allow-list of types -> extension (SVG and HTML are excluded for security)
const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

// Store files in memory buffer so they can be piped straight to ImageKit
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new ChatError('This file type is not allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
}).array('files', MAX_FILES);

/**
 * Runs BEFORE multer: confirms the user is an active member of an active group,
 * so non-members can never upload files.
 */
export async function ensureCanPost(req: Request, res: Response, next: NextFunction) {
  try {
    const groupId = Number(req.params.groupId);
    if (!req.user || !Number.isInteger(groupId)) throw new ChatError('Group not found', 404);
    await assertCanPost(req.user, groupId);
    next();
  } catch (err) {
    if (err instanceof ChatError) {
      res.status(err.statusCode).json({ success: false, message: err.message });
      return;
    }
    console.error('ensureCanPost error:', err);
    res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

/** multer wrapped so upload errors become clean 400 responses. */
export function uploadFiles(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) return next();

    let message = 'Upload failed';
    if (err instanceof multer.MulterError) {
      message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Each file must be 10 MB or smaller'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `You can attach at most ${MAX_FILES} files`
            : err.message;
    } else if (err instanceof ChatError) {
      message = err.message;
    }
    res.status(400).json({ success: false, message });
  });
}