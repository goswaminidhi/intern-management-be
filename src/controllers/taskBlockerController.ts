import type { Request, Response } from 'express';

import {
  raiseBlocker,
  sendBlockerMessage,
  listBlockers,
  getBlockerById,
  getBlockerConversation,
  getBlockerMessages,
  resolveBlocker,
} from '../service/taskBlockerService';
import type { AuthUser } from '../service/taskBlockerService';

interface ControllerError extends Error {
  statusCode?: number;
}

const handleError = (res: Response, error: unknown) => {
  const err = error as ControllerError;

  // Two simultaneous "raise" requests hit the unique index
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      success: false,
      message: 'An open blocker already exists for this task',
    });
  }

  const status = err.statusCode || 500;
  if (status >= 500) console.error('Task blocker error:', err);

  return res.status(status).json({
    success: false,
    // Never leak internal/database messages on server errors
    message: status >= 500 ? 'Internal server error' : err.message,
  });
};

const getAuthUser = (req: Request): AuthUser => {
  const id = Number(req.user?.id);
  const role = req.user?.role;

  if (!Number.isInteger(id) || id <= 0 || !role) {
    const error = new Error('Authentication required') as ControllerError;
    error.statusCode = 401;
    throw error;
  }
  return { id, role };
};

const parseId = (value: unknown, label: string): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`Invalid ${label}`) as ControllerError;
    error.statusCode = 400;
    throw error;
  }
  return id;
};

// POST /api/blockers   (taskId in body)
// POST /api/blockers/tasks/:taskId
export const raiseTaskBlocker = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const taskId = parseId(req.params.taskId ?? req.body?.taskId, 'task ID');

    const result = await raiseBlocker(taskId, user.id, req.body?.message);

    return res.status(201).json({
      success: true,
      message: 'Blocker raised successfully',
      data: {
        conversation: result.conversation,
        message: result.message,
        recipientId: result.mentorId,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/blockers?status=open|resolved
export const listTaskBlockers = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;

    const blockers = await listBlockers(user, status);
    return res.status(200).json({ success: true, data: blockers });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/blockers/:conversationId
export const getTaskBlockerById = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const conversationId = parseId(req.params.conversationId, 'conversation ID');

    const conversation = await getBlockerById(conversationId, user);
    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/blockers/tasks/:taskId
export const getTaskBlockerConversation = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const taskId = parseId(req.params.taskId, 'task ID');

    const conversation = await getBlockerConversation(taskId, user);
    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/blockers/:conversationId/messages
export const getTaskBlockerMessages = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const conversationId = parseId(req.params.conversationId, 'conversation ID');
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const result = await getBlockerMessages(conversationId, user, page, limit);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /api/blockers/:conversationId/messages
export const sendTaskBlockerMessage = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const conversationId = parseId(req.params.conversationId, 'conversation ID');

    const result = await sendBlockerMessage(
      conversationId,
      user.id,
      req.body?.message
    );

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: { message: result.message, recipientId: result.recipientId },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// PATCH /api/blockers/:conversationId/resolve
export const resolveTaskBlocker = async (req: Request, res: Response) => {
  try {
    const user = getAuthUser(req);
    const conversationId = parseId(req.params.conversationId, 'conversation ID');

    const result = await resolveBlocker(conversationId, user);

    return res.status(200).json({
      success: true,
      message: 'Blocker resolved successfully',
      data: {
        conversation: result.conversation,
        task: result.task,
        recipientId: result.mentorId,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};