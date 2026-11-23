
import { Request, Response, NextFunction } from 'express';


import {
  ServiceError,
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  updateTaskStatus,
  submitTask,
  evaluateTask,
  deleteTask,
} from '../service/taskService';
import type { TaskActor, TaskQueryFilters, UpdateTaskInput } from '../service/taskService';
import type { TaskCategory, TaskPriority, TaskStatus, TaskAttachment } from '../models/tasks';
import { uploadToImageKit, fetchAndDecryptFromImageKit } from '../service/imageKitService';
function getActor(req: Request): TaskActor | null {
  if (!req.user) return null;
  return {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
    assignedMentees: req.user.assignedMentees,
  };
}

function handleTaskError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ServiceError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }
  next(error);
}

// CREATE TASK (Admin & Mentor)
export const createTaskController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const {
      title,
      description,
      category,
      priority,
      start_date,
      due_date,
      estimated_hours,
      mentee_id,
    } = req.body as {
      title: string;
      description: string;
      category?: TaskCategory;
      priority?: TaskPriority;
      start_date: Date;
      due_date: Date;
      estimated_hours: number | null;
      mentee_id: number;
    };

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const attachments: TaskAttachment[] = [];

    if (files.length > 0) {
      for (const f of files) {
        const uploaded = await uploadToImageKit(f.buffer, f.originalname, '/tasks');
        attachments.push({
          id: uploaded.fileId,
          name: f.originalname,
          key: uploaded.fileId,
          url: uploaded.url,
          size: f.size,
          type: f.mimetype,
        });
      }
    }

    const task = await createTask(
      {
        title,
        description,
        category,
        priority,
        start_date: new Date(start_date),
        due_date: new Date(due_date),
        estimated_hours:
         estimated_hours === null || estimated_hours === undefined || String(estimated_hours).trim() === ''
        ? null
        : Number(estimated_hours),
        mentee_id: Number(mentee_id),
        assigned_by: actor.id,
        attachments,
      },
      actor
    );

    return res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: task,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// GET ALL TASKS (Role-scoped)
export const getAllTasksController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const q = (req.validatedQuery ?? req.query) as Record<string, unknown>;
    const filters: TaskQueryFilters = {};

    if (q.mentee_id !== undefined) filters.mentee_id = Number(q.mentee_id);
    if (q.assigned_by !== undefined) filters.assigned_by = Number(q.assigned_by);
    if (typeof q.status === 'string') filters.status = q.status as TaskStatus;
    if (typeof q.category === 'string') filters.category = q.category as TaskCategory;
    if (typeof q.priority === 'string') filters.priority = q.priority as TaskPriority;
    if (q.page !== undefined) filters.page = Number(q.page);
    if (q.limit !== undefined) filters.limit = Number(q.limit);

    const { rows, count, page, limit } = await getAllTasks(filters, actor);

    return res.status(200).json({
      success: true,
      message: 'Tasks fetched successfully',
      count: rows.length,
      total: count,
      page,
      totalPages: limit ? Math.max(1, Math.ceil(count / limit)) : 1,
      data: rows,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// GET TASK BY ID (Role-scoped)
export const getTaskByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const task = await getTaskById(Number(req.params.id), actor);

    return res.status(200).json({
      success: true,
      message: 'Task fetched successfully',
      data: task,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// UPDATE TASK (Admin & owning Mentor)
export const updateTaskController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const {
      title,
      description,
      category,
      priority,
      start_date,
      due_date,
      estimated_hours,
      mentee_id,
      status,
    } = req.body as Record<string, unknown>;

    const updateData: UpdateTaskInput = {};
    if (title !== undefined) updateData.title = String(title);
    if (description !== undefined) updateData.description = String(description);
    if (category !== undefined) updateData.category = category as TaskCategory;
    if (priority !== undefined) updateData.priority = priority as TaskPriority;
    if (start_date !== undefined) updateData.start_date = new Date(String(start_date));
    if (due_date !== undefined) updateData.due_date = new Date(String(due_date));
    if (estimated_hours !== undefined) {
    updateData.estimated_hours =
    estimated_hours === null || String(estimated_hours).trim() === ''
      ? null
      : Number(estimated_hours);
}
    if (mentee_id !== undefined) updateData.mentee_id = Number(mentee_id);
    if (status !== undefined) updateData.status = status as TaskStatus;

    const task = await updateTask(Number(req.params.id), updateData, actor);

    return res.status(200).json({
      success: true,
      message: 'Task updated successfully',
      data: task,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// UPDATE TASK STATUS (Assigned Mentee, Admin & owning Mentor)
export const updateTaskStatusController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { status } = req.body as { status: TaskStatus };
    const task = await updateTaskStatus(Number(req.params.id), status, actor);

    return res.status(200).json({
      success: true,
      message: 'Task status updated successfully',
      data: task,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
  
};

// SUBMIT TASK WORK (Assigned Mentee only)
export const submitTaskController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { submission_url, demo_url, submission_notes } = req.body as {
      submission_url: string;
      demo_url?: string | null;
      submission_notes?: string | null;
    };

    const task = await submitTask(
      Number(req.params.id),
      { submission_url, demo_url, submission_notes },
      actor
    );

    return res.status(200).json({
      success: true,
      message: 'Task submitted successfully',
      data: task,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// EVALUATE TASK SUBMISSION (Admin & owning Mentor)
export const evaluateTaskController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { score, feedback, status } = req.body as {
      score?: number | null;
      feedback: string;
      status: 'complete' | 'needs-revision';
    };

    const task = await evaluateTask(
      Number(req.params.id),
      { score, feedback, status },
      actor
    );

    return res.status(200).json({
      success: true,
      message:
        status === 'complete'
          ? 'Task evaluated and marked complete'
          : 'Revision requested successfully',
      data: task,
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// DELETE TASK (Admin & owning Mentor)
export const deleteTaskController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    await deleteTask(Number(req.params.id), actor);

    return res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    handleTaskError(error, res, next);
  }
};

// DOWNLOAD & DECRYPT TASK ATTACHMENT
export const downloadTaskAttachmentController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const taskId = Number(req.params.id);
    const attachmentId = req.params.attachmentId;

    const task = await getTaskById(taskId, actor);
    const attachments: TaskAttachment[] = Array.isArray(task.attachments) ? task.attachments : [];
    const att = attachments.find((a, index) => a.id === attachmentId || String(index) === attachmentId);

    if (!att || !att.url) {
      return res.status(404).json({ success: false, message: 'Attachment not found' });
    }

    const decryptedBuffer = await fetchAndDecryptFromImageKit(att.url);
    const mimeType = att.type || 'application/octet-stream';
    const inline = mimeType.startsWith('image/') || mimeType === 'application/pdf';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', decryptedBuffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.name || 'attachment')}`
    );
    return res.send(decryptedBuffer);
  } catch (error) {
    handleTaskError(error, res, next);
  }
};
