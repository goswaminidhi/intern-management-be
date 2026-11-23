import { Op } from 'sequelize';
import type { WhereOptions } from 'sequelize';
import Task from '../models/tasks';
import type {
  TaskAttributes,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  TaskAttachment,
} from '../models/tasks';
import User from '../models/user';
import type { UserRole } from '../models/user';
import { bulkDeleteFromImageKit } from './imageKitService';
import { initAssociations } from '../models/associations';
import {
  safeNotify,
  notifyTaskAssigned,
  notifyTaskUpdated,
  notifyTaskSubmitted,
  notifyTaskStatusChanged,
  notifyTaskChangeRequest,
  notifyEvaluationSubmitted,
} from '../service/notificationService';
import {
  addUsersToTaskGroups,
  removeUserFromTaskGroups,
  archiveTaskGroups,
} from '../service/chatService';
import { closeActiveLogForTask } from './timeLogService';

// Ensure Sequelize associations are registered before any included queries
initAssociations();

export class ServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ServiceError';
  }
}

export interface TaskActor {
  id: number;
  name: string;
  role: UserRole;
  assignedMentees: number[];
}

export interface CreateTaskInput {
  title: string;
  description: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  start_date: Date;
  due_date: Date;
  estimated_hours?: number | null;   // optional
  mentee_id: number;
  assigned_by: number;
  attachments?: TaskAttachment[];
}

export type UpdateTaskInput = Partial<
  Pick<
    TaskAttributes,
    | 'title'
    | 'description'
    | 'category'
    | 'priority'
    | 'start_date'
    | 'due_date'
    | 'estimated_hours'
    | 'mentee_id'
    | 'status'
  >
>;

export interface SubmitTaskInput {
  submission_url: string;
  demo_url?: string | null;
  submission_notes?: string | null;
}

export interface EvaluateTaskInput {
  score?: number | null;
  feedback: string;
  status: 'complete' | 'needs-revision';
}

export interface TaskQueryFilters {
  mentee_id?: number;
  assigned_by?: number;
  status?: TaskStatus;
  category?: TaskCategory;
  priority?: TaskPriority;
  page?: number;
  limit?: number;
}

const TASK_USER_INCLUDES = [
  { model: User, as: 'mentee', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'assigner', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'evaluator', attributes: ['id', 'name', 'email'] },
];

/** Collect IDs of all mentees assigned to the given mentor (FK, name & JSONB links). */
async function getMentorMenteeIds(actor: TaskActor): Promise<number[]> {
  const rows = await User.findAll({
    where: {
      role: 'mentee',
      [Op.or]: [
        { mentor_id: actor.id },
        { assigned_to: { [Op.iLike]: actor.name.trim() } },
      ],
    },
    attributes: ['id'],
  });

  const ids = new Set<number>(
    Array.isArray(actor.assignedMentees) ? actor.assignedMentees : []
  );
  for (const row of rows) {
    ids.add(row.id);
  }
  return Array.from(ids);
}

/** Verify the target user exists, is an active mentee, and belongs to actor if actor is a mentor. */
async function validateTargetMentee(
  menteeId: number,
  actor: TaskActor
): Promise<void> {
  const mentee = await User.findByPk(menteeId);

  if (!mentee || mentee.role !== 'mentee') {
    throw new ServiceError(400, 'Selected recipient must be a valid mentee');
  }

  if (mentee.status !== 'active') {
    throw new ServiceError(400, 'Cannot assign a task to an inactive mentee');
  }

  if (actor.role === 'mentor') {
    const mentorMenteeIds = await getMentorMenteeIds(actor);
    const assignedByFk = mentee.mentor_id === actor.id;
    const assignedNameMatches =
      mentee.assigned_to?.trim().toLowerCase() === actor.name.trim().toLowerCase();
    if (!assignedByFk && !assignedNameMatches && !mentorMenteeIds.includes(mentee.id)) {
      throw new ServiceError(
        403,
        'You can only assign tasks to mentees assigned to you'
      );
    }
  }
}

/** Verify actor has permission to view/manage a task based on role and ownership. */
async function assertMentorCanAccess(
  task: Task,
  actor: TaskActor
): Promise<void> {
  if (actor.role === 'admin') return;
  if (actor.role === 'mentor') {
    if (task.assigned_by === actor.id) return;
    const menteeIds = await getMentorMenteeIds(actor);
    if (menteeIds.includes(task.mentee_id)) return;
  }
  throw new ServiceError(403, 'You do not have permission to access this task');
}

function validateTaskDates(startDate: Date, dueDate: Date): void {
  const s = new Date(startDate);
  const d = new Date(dueDate);
  if (Number.isNaN(s.getTime()) || Number.isNaN(d.getTime())) {
    throw new ServiceError(400, 'Valid start_date and due_date are required');
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (s < todayStart) {
    throw new ServiceError(400, 'Start date cannot be in the past');
  }

  if (d.getTime() < Date.now() - 60000) {
    throw new ServiceError(400, 'Due date cannot be in the past');
  }

  if (s >= d) {
    throw new ServiceError(400, 'Start date must be less than due date');
  }
}

/** Fetch a single task hydrated with user associations. */
async function fetchHydratedTask(id: number): Promise<Task | null> {
  return Task.findByPk(id, { include: TASK_USER_INCLUDES });
}

// Create a new task
export const createTask = async (
  taskData: CreateTaskInput,
  actor: TaskActor
): Promise<Task> => {
  validateTaskDates(taskData.start_date, taskData.due_date);

  // Estimated hours is optional; validate only when provided
  const estimatedHours = taskData.estimated_hours ?? null;
  if (
    estimatedHours !== null &&
    (!Number.isFinite(estimatedHours) || estimatedHours <= 0)
  ) {
    throw new ServiceError(400, 'Estimated hours must be greater than zero');
  }

  await validateTargetMentee(taskData.mentee_id, actor);

  const created = await Task.create({
    title: taskData.title.trim(),
    description: (taskData.description ?? '').trim(),
    category: taskData.category ?? 'upskill',
    priority: taskData.priority ?? 'medium',
    start_date: taskData.start_date,
    due_date: taskData.due_date,
    estimated_hours: estimatedHours,
    mentee_id: taskData.mentee_id,
    assigned_by: actor.id,
    attachments: taskData.attachments || [],
    status: 'in-progress',
  });

  // Mentee gets TASK_ASSIGNED notification
  await safeNotify(() => notifyTaskAssigned(created.mentee_id, created, actor.name));

  const hydrated = await fetchHydratedTask(created.id);
  return hydrated ?? created;
};

// Get all tasks scoped by caller role
export const getAllTasks = async (
  filters: TaskQueryFilters = {},
  actor: TaskActor
) => {
  const andConditions: WhereOptions<TaskAttributes>[] = [];

  if (filters.status) andConditions.push({ status: filters.status });
  if (filters.category) andConditions.push({ category: filters.category });
  if (filters.priority) andConditions.push({ priority: filters.priority });

  if (actor.role === 'mentee') {
    if (filters.mentee_id !== undefined && filters.mentee_id !== actor.id) {
      return { rows: [], count: 0, page: filters.page ?? 1, limit: filters.limit ?? null };
    }
    andConditions.push({ mentee_id: actor.id });
    if (filters.assigned_by !== undefined) {
      andConditions.push({ assigned_by: filters.assigned_by });
    }
  } else if (actor.role === 'mentor') {
    const menteeIds = await getMentorMenteeIds(actor);
    const mentorScopeOr: WhereOptions<TaskAttributes>[] = [{ assigned_by: actor.id }];
    if (menteeIds.length > 0) {
      mentorScopeOr.push({ mentee_id: { [Op.in]: menteeIds } });
    }
    andConditions.push({ [Op.or]: mentorScopeOr });

    if (filters.mentee_id !== undefined) {
      andConditions.push({ mentee_id: filters.mentee_id });
    }
    if (filters.assigned_by !== undefined) {
      andConditions.push({ assigned_by: filters.assigned_by });
    }
  } else {
    // Admin sees all tasks and can filter freely
    if (filters.mentee_id !== undefined) {
      andConditions.push({ mentee_id: filters.mentee_id });
    }
    if (filters.assigned_by !== undefined) {
      andConditions.push({ assigned_by: filters.assigned_by });
    }
  }

  const where: WhereOptions<TaskAttributes> =
    andConditions.length > 0 ? { [Op.and]: andConditions } : {};

  const usePagination = filters.page !== undefined || filters.limit !== undefined;
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const result = await Task.findAndCountAll({
    where,
    include: TASK_USER_INCLUDES,
    order: [['createdAt', 'DESC']],
    ...(usePagination ? { limit, offset: (page - 1) * limit } : {}),
    distinct: true,
  });

  return {
    rows: result.rows,
    count: result.count,
    page: usePagination ? page : 1,
    limit: usePagination ? limit : null,
  };
};

// Get task by ID (with ownership verification)
export const getTaskById = async (id: number, actor: TaskActor): Promise<Task> => {
  const task = await fetchHydratedTask(id);

  if (!task) {
    throw new ServiceError(404, 'Task not found');
  }

  if (actor.role === 'mentee') {
    if (task.mentee_id !== actor.id) {
      throw new ServiceError(403, 'You do not have permission to access this task');
    }
    return task;
  }

  await assertMentorCanAccess(task, actor);
  return task;
};

// Update task (Admin & owning Mentor only)
export const updateTask = async (
  id: number,
  updateData: UpdateTaskInput,
  actor: TaskActor
): Promise<Task> => {
  const task = await Task.findByPk(id);

  if (!task) {
    throw new ServiceError(404, 'Task not found');
  }

  await assertMentorCanAccess(task, actor);

  if (updateData.status === 'complete' || updateData.status === 'needs-revision') {
    throw new ServiceError(400, 'Use the evaluate endpoint to approve or request revision');
  }
  if (updateData.status === 'submitted') {
    throw new ServiceError(400, 'Tasks can only be submitted by the assigned mentee');
  }
  if (
    updateData.estimated_hours !== undefined &&
    updateData.estimated_hours !== null &&
    (!Number.isFinite(updateData.estimated_hours) || updateData.estimated_hours <= 0)
  ) {
    throw new ServiceError(400, 'Estimated hours must be greater than zero');
  }

  const startDate = updateData.start_date ?? task.start_date;
  const dueDate = updateData.due_date ?? task.due_date;
  validateTaskDates(startDate, dueDate);

  if (
  updateData.estimated_hours !== undefined &&
  updateData.estimated_hours !== null &&
  (!Number.isFinite(updateData.estimated_hours) || updateData.estimated_hours <= 0)
) {
  throw new ServiceError(400, 'Estimated hours must be greater than zero');
}

  if (updateData.mentee_id !== undefined && updateData.mentee_id !== task.mentee_id) {
    await validateTargetMentee(updateData.mentee_id, actor);
  }

  const sanitizedUpdates: UpdateTaskInput = { ...updateData };
  if (sanitizedUpdates.title !== undefined) {
    sanitizedUpdates.title = sanitizedUpdates.title.trim();
  }
  if (sanitizedUpdates.description !== undefined) {
    sanitizedUpdates.description = sanitizedUpdates.description.trim();
  }

  const previousMenteeId = task.mentee_id;
  const dueDateChanged =
    updateData.due_date !== undefined &&
    new Date(updateData.due_date).getTime() !== new Date(task.due_date).getTime();

  await task.update({
    ...sanitizedUpdates,
    ...(dueDateChanged ? { due_reminder_sent: false } : {}),
  });

  if (
    sanitizedUpdates.status === 'hold' ||
    sanitizedUpdates.status === 'blocker' ||
    sanitizedUpdates.status === 'submitted' ||
    sanitizedUpdates.status === 'complete'
  ) {
    await closeActiveLogForTask(task.id);
  }

  // Reassignment handlers
  if (updateData.mentee_id !== undefined && updateData.mentee_id !== previousMenteeId) {
    await safeNotify(() => notifyTaskAssigned(task.mentee_id, task, actor.name));
    // Synchronize chat memberships for this task
    await removeUserFromTaskGroups(task.id, previousMenteeId).catch(() => undefined);
    await addUsersToTaskGroups(task.id, [task.mentee_id]).catch(() => undefined);
  }

  if (actor.role === 'admin' && task.assigned_by !== actor.id) {
    await safeNotify(() => notifyTaskUpdated(task.assigned_by, task, actor.name));
  }

  const hydrated = await fetchHydratedTask(task.id);
  return hydrated ?? task;
};

// Submit work for a task (assigned Mentee only)
export const submitTask = async (
  id: number,
  input: SubmitTaskInput,
  actor: TaskActor
): Promise<Task> => {
  const task = await Task.findByPk(id);

  if (!task) {
    throw new ServiceError(404, 'Task not found');
  }

  if (actor.role !== 'mentee' || task.mentee_id !== actor.id) {
    throw new ServiceError(403, 'Only the assigned mentee can submit this task');
  }

  if (task.status === 'complete' || task.status === 'hold' || task.status === 'submitted') {
    throw new ServiceError(
      400,
      `Cannot submit a task whose status is '${task.status}'`
    );
  }

  await task.update({
    submission_url: input.submission_url.trim(),
    demo_url: input.demo_url ? input.demo_url.trim() : null,
    submission_notes: input.submission_notes ? input.submission_notes.trim() : null,
    submitted_at: new Date(),
    status: 'submitted',
  });

  // Automatically close any running timer on this task
  await closeActiveLogForTask(task.id);

  // Mentor gets TASK_SUBMITTED notification
  await safeNotify(() => notifyTaskSubmitted(task.assigned_by, task, actor.name));

  const hydrated = await fetchHydratedTask(task.id);
  return hydrated ?? task;
};

// Evaluate a submitted task (Admin & owning Mentor only)
export const evaluateTask = async (
  id: number,
  input: EvaluateTaskInput,
  actor: TaskActor
): Promise<Task> => {
  const task = await Task.findByPk(id);

  if (!task) {
    throw new ServiceError(404, 'Task not found');
  }

  await assertMentorCanAccess(task, actor);

  if (task.status !== 'submitted') {
    throw new ServiceError(
      400,
      'Task must be in submitted status to be evaluated'
    );
  }

  await task.update({
    score: null,
    feedback: input.feedback.trim(),
    status: input.status,
    evaluated_by: actor.id,
    evaluated_at: new Date(),
  });

  if (input.status === 'needs-revision') {
    await safeNotify(() => notifyTaskChangeRequest(task.mentee_id, task));
  } else {
    await safeNotify(() =>
      notifyEvaluationSubmitted(task.mentee_id, task)
    );
  }

  const hydrated = await fetchHydratedTask(task.id);
  return hydrated ?? task;
};

// Update task status (Mentee for own task, Admin & owning Mentor)
export const updateTaskStatus = async (
  id: number,
  status: TaskStatus,
  actor: TaskActor
): Promise<Task> => {
  const task = await Task.findByPk(id);

  if (!task) {
    throw new ServiceError(404, 'Task not found');
  }

  if (actor.role === 'mentee') {
    if (task.mentee_id !== actor.id) {
      throw new ServiceError(403, 'You can only update the status of your own tasks');
    }
    if (task.status === 'submitted' || task.status === 'complete' || task.status === 'needs-revision') {
      throw new ServiceError(400, `Cannot change status when task is ${task.status}`);
    }
    if (status !== 'in-progress' && status !== 'hold' && status !== 'blocker') {
      throw new ServiceError(400, 'Mentees can only set status to in-progress , hold or blocker');
    }
  } else {
    await assertMentorCanAccess(task, actor);
    if (status === 'complete' || status === 'needs-revision') {
      throw new ServiceError(400, 'Use the evaluate endpoint to approve or request revision');
    }
    if (status === 'submitted') {
      throw new ServiceError(400, 'Tasks can only be submitted by the assigned mentee');
    }
  }

  const previousStatus = task.status;

  await task.update({ status });

  if (status === 'hold' || status === 'blocker') {
    await closeActiveLogForTask(task.id);
  }

  if (actor.role === 'mentee' && previousStatus !== status) {
    await safeNotify(() =>
      notifyTaskStatusChanged(task.assigned_by, task, actor.name, status)
    );
  }

  const hydrated = await fetchHydratedTask(task.id);
  return hydrated ?? task;
};

// Delete task (soft delete, Admin & owning Mentor only)
export const deleteTask = async (
  id: number,
  actor: TaskActor
): Promise<Task> => {
  const task = await Task.findByPk(id);

  if (!task) {
    throw new ServiceError(404, 'Task not found');
  }

  await assertMentorCanAccess(task, actor);

  // Archive any chat group linked to this task
  await archiveTaskGroups(task.id).catch(() => undefined);

  // Clean up any ImageKit attachments
  if (Array.isArray(task.attachments) && task.attachments.length > 0) {
    const fileIds = task.attachments.map((a: any) => a.key || a.id).filter(Boolean);
    if (fileIds.length > 0) {
      void bulkDeleteFromImageKit(fileIds);
    }
  }

  await task.destroy();
  return task;
};