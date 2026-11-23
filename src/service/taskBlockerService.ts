import { UniqueConstraintError } from 'sequelize';
import Task from '../models/tasks';
import User from '../models/user';
import type { UserRole } from '../models/user';
import TaskBlockerConversation from '../models/taskBlockerConversation';
import TaskBlockerMessage from '../models/taskBlockerMessage';
import { sequelize } from '../config/database';
import { createBlockerNotification } from './notificationService';
import { closeActiveLogForTask } from './timeLogService';

interface ServiceError extends Error {
  statusCode?: number;
}

const createError = (message: string, statusCode: number): ServiceError => {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
};

export interface AuthUser {
  id: number;
  role: UserRole;
}

const MAX_MESSAGE_LENGTH = 2000;

const validateMessage = (message: unknown): string => {
  if (typeof message !== 'string' || !message.trim()) {
    throw createError('Message cannot be empty', 400);
  }
  const clean = message.trim();
  if (clean.length > MAX_MESSAGE_LENGTH) {
    throw createError(
      `Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`,
      400
    );
  }
  return clean;
};

const isParticipant = (
  conversation: TaskBlockerConversation,
  userId: number
): boolean =>
  Number(conversation.menteeId) === userId ||
  Number(conversation.mentorId) === userId;

// Admins may VIEW conversations; only mentee/mentor may send messages.
const assertCanView = (
  conversation: TaskBlockerConversation,
  user: AuthUser
): void => {
  if (user.role !== 'admin' && !isParticipant(conversation, user.id)) {
    throw createError('You cannot access this conversation', 403);
  }
};

// Notifications must never make the main request fail.
type NotificationPayload = Parameters<typeof createBlockerNotification>[0];
const safeNotify = async (payload: NotificationPayload): Promise<void> => {
  try {
    await createBlockerNotification(payload);
  } catch (error) {
    console.error('Failed to send blocker notification:', error);
  }
};

// Reused in several queries so the response shape is consistent
const conversationIncludes = [
  { model: Task, as: 'task', attributes: ['id', 'title', 'status', 'due_date'] },
  { model: User, as: 'mentee', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'mentor', attributes: ['id', 'name', 'email'] },
];

/**
 * 1. Raise a blocker (mentee only; role is also checked in the route).
 *
 * ONE conversation per task:
 *  - no conversation yet  -> create it
 *  - conversation is open -> 409
 *  - conversation resolved -> REOPEN it, so the new message continues
 *    the previous history instead of starting a new thread
 */
export const raiseBlocker = async (
  taskId: number,
  menteeId: number,
  message: unknown
) => {
  const cleanMessage = validateMessage(message);

  let result;
  try {
    result = await sequelize.transaction(async (transaction) => {
      const task = await Task.findByPk(taskId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!task) throw createError('Task not found', 404);

      if (Number(task.mentee_id) !== menteeId) {
        throw createError(
          'You are not authorized to raise a blocker for this task',
          403
        );
      }

      if (task.status === 'complete') {
        throw createError('Cannot raise a blocker on a completed task', 400);
      }

      // Find the mentor: mentee's mentor_id first, then the task assigner.
      const mentee = await User.findByPk(menteeId, { transaction });
      const candidateIds = [mentee?.mentor_id, task.assigned_by]
        .filter((id) => id !== null && id !== undefined)
        .map(Number);

      let mentorId: number | null = null;
      for (const candidateId of candidateIds) {
        const candidate = await User.findByPk(candidateId, { transaction });
        if (
          candidate &&
          candidate.role === 'mentor' &&
          candidate.status === 'active'
        ) {
          mentorId = candidate.id;
          break;
        }
      }

      if (!mentorId) {
        throw createError('No active mentor is assigned to this mentee', 400);
      }

      // The single conversation for this task (if any)
      let conversation = await TaskBlockerConversation.findOne({
        where: { taskId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      let reopened = false;

      if (!conversation) {
        conversation = await TaskBlockerConversation.create(
          { taskId, menteeId, mentorId, status: 'open' },
          { transaction }
        );
      } else if (conversation.status === 'open') {
        throw createError('An open blocker already exists for this task', 409);
      } else {
        // Resolved earlier: reopen the same conversation.
        // Refresh the people in case the task or mentor changed since.
        await conversation.update(
          { status: 'open', menteeId, mentorId },
          { transaction }
        );
        reopened = true;
      }

      const blockerMessage = await TaskBlockerMessage.create(
        {
          conversationId: conversation.id,
          senderId: menteeId,
          message: cleanMessage,
        },
        { transaction }
      );

      await task.update({ status: 'blocker' }, { transaction });
      await closeActiveLogForTask(task.id, transaction);

      return { conversation, message: blockerMessage, task, mentorId, reopened };
    });
  } catch (error) {
    // Two simultaneous requests can both pass the check above;
    // the unique index on taskId stops the second one.
    if (error instanceof UniqueConstraintError) {
      throw createError('An open blocker already exists for this task', 409);
    }
    throw error;
  }

  // After commit
  await safeNotify({
    recipientId: result.mentorId,
    senderId: menteeId,
    conversationId: result.conversation.id,
    taskId,
    type: 'BLOCKER_RAISED',
    title: result.reopened ? 'Task Blocker Reopened' : 'New Task Blocker',
    message: result.reopened
      ? `A mentee has reopened the blocker on "${result.task.title}".`
      : `A mentee has raised a blocker on "${result.task.title}".`,
  });

  return result;
};

/**
 * 2. Send a message (mentee or mentor who belongs to the conversation).
 */
export const sendBlockerMessage = async (
  conversationId: number,
  senderId: number,
  message: unknown
) => {
  const cleanMessage = validateMessage(message);

  const result = await sequelize.transaction(async (transaction) => {
    const conversation = await TaskBlockerConversation.findByPk(
      conversationId,
      { transaction, lock: transaction.LOCK.UPDATE }
    );
    if (!conversation) throw createError('Blocker conversation not found', 404);

    if (!isParticipant(conversation, senderId)) {
      throw createError('You cannot access this conversation', 403);
    }

    if (conversation.status !== 'open') {
      throw createError('This blocker conversation is resolved', 400);
    }

    const newMessage = await TaskBlockerMessage.create(
      { conversationId, senderId, message: cleanMessage },
      { transaction }
    );

    // Bump updatedAt so lists can sort by latest activity
    conversation.changed('updatedAt', true);
    await conversation.save({ transaction });

    const recipientId =
      Number(conversation.menteeId) === senderId
        ? Number(conversation.mentorId)
        : Number(conversation.menteeId);

    return { conversation, message: newMessage, recipientId };
  });

  await safeNotify({
    recipientId: result.recipientId,
    senderId,
    conversationId,
    taskId: result.conversation.taskId,
    type: 'BLOCKER_MESSAGE',
    title: 'New Blocker Message',
    message: 'You have received a new message in a blocker conversation.',
  });

  return result;
};

/**
 * 3. List blockers for the logged-in user (by role).
 */
export const listBlockers = async (user: AuthUser, status?: string) => {
  const where: Record<string, unknown> = {};

  if (user.role === 'mentee') where.menteeId = user.id;
  else if (user.role === 'mentor') where.mentorId = user.id;
  // admin: no filter (all blockers)

  if (status === 'open' || status === 'resolved') where.status = status;

  return TaskBlockerConversation.findAll({
    where,
    include: conversationIncludes,
    order: [['updatedAt', 'DESC']],
  });
};

/**
 * 4. One conversation with task, people, messages and senders.
 */
export const getBlockerById = async (
  conversationId: number,
  user: AuthUser
) => {
  const conversation = await TaskBlockerConversation.findByPk(conversationId, {
    include: [
      ...conversationIncludes,
      {
        model: TaskBlockerMessage,
        as: 'messages',
        include: [
          { model: User, as: 'sender', attributes: ['id', 'name', 'role'] },
        ],
      },
    ],
    order: [[{ model: TaskBlockerMessage, as: 'messages' }, 'createdAt', 'ASC']],
  });

  if (!conversation) throw createError('Blocker conversation not found', 404);
  assertCanView(conversation, user);
  return conversation;
};

/**
 * 5. The conversation for a task (there is only ever one per task).
 */
export const getBlockerConversation = async (
  taskId: number,
  user: AuthUser
) => {
  const conversation = await TaskBlockerConversation.findOne({
    where: { taskId },
  });

  if (!conversation) throw createError('No blocker conversation found', 404);
  assertCanView(conversation, user);
  return getBlockerById(conversation.id, user);
};

/**
 * 6. Messages with pagination (oldest to newest within the page).
 */
export const getBlockerMessages = async (
  conversationId: number,
  user: AuthUser,
  page = 1,
  limit = 20
) => {
  const conversation = await TaskBlockerConversation.findByPk(conversationId);
  if (!conversation) throw createError('Blocker conversation not found', 404);
  assertCanView(conversation, user);

  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));

  const { count, rows } = await TaskBlockerMessage.findAndCountAll({
    where: { conversationId },
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'role'] }],
    order: [['createdAt', 'DESC']], // camelCase column in these tables
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  });

  return {
    messages: rows.reverse(),
    pagination: {
      totalMessages: count,
      currentPage: safePage,
      totalPages: Math.ceil(count / safeLimit),
      limit: safeLimit,
    },
  };
};

/**
 * 7. Resolve a blocker.
 * ONLY the mentee who raised it can do this.
 * The conversation is kept (status = resolved) so it can be reopened later.
 */
export const resolveBlocker = async (
  conversationId: number,
  user: AuthUser
) => {
  if (user.role !== 'mentee') {
    throw createError('Only mentees can resolve a blocker', 403);
  }

  const result = await sequelize.transaction(async (transaction) => {
    const conversation = await TaskBlockerConversation.findByPk(
      conversationId,
      { transaction, lock: transaction.LOCK.UPDATE }
    );
    if (!conversation) throw createError('Blocker conversation not found', 404);

    if (Number(conversation.menteeId) !== user.id) {
      throw createError(
        'Only the mentee who raised this blocker can resolve it',
        403
      );
    }

    if (conversation.status === 'resolved') {
      throw createError('This blocker is already resolved', 400);
    }

    await conversation.update({ status: 'resolved' }, { transaction });

    const task = await Task.findByPk(conversation.taskId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!task) throw createError('Associated task not found', 404);

    // Only move back to in-progress if it is still a blocker
    if (task.status === 'blocker') {
      await task.update({ status: 'in-progress' }, { transaction });
    }

    return { conversation, task };
  });

  await safeNotify({
    recipientId: Number(result.conversation.mentorId),
    senderId: user.id,
    conversationId: result.conversation.id,
    taskId: result.conversation.taskId,
    type: 'BLOCKER_RESOLVED',
    title: 'Task Blocker Resolved',
    message: 'The mentee has resolved the task blocker.',
  });

  return { ...result, mentorId: Number(result.conversation.mentorId) };
};