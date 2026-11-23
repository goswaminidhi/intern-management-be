import type { Transaction } from 'sequelize';
import { Notification } from '../models/notification';
import type { NotificationType } from '../models/notification';
import { getIO } from '../socket';

/* ---------- Who receives what ---------- */
export const MENTEE_TYPES: NotificationType[] = [
  'TASK_ASSIGNED',
  'TASK_DUE_DATE',
  'TASK_CHANGE_REQUEST',
  'EVALUATION_SUBMITTED',
  'NEW_MESSAGE',
  'GROUP_CREATED',
  'ADDED_TO_GROUP',
  'BLOCKER_MESSAGE'
];

export const MENTOR_TYPES: NotificationType[] = [
  'TASK_UPDATED',
  'TASK_SUBMITTED',
  'TASK_STATUS_CHANGED',
  'NEW_MESSAGE',
  'GROUP_CREATED',
  'BLOCKER_RAISED',    // mentee raised a blocker
  'BLOCKER_MESSAGE',   // mentee replied
  'BLOCKER_RESOLVED',  // mentee resolved it
 
];

/* ---------- Core ---------- */
export interface NewNotification {
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

interface TaskRef {
  id: number;
  title: string;
}


interface BlockerNotificationData {
  recipientId: number;
  senderId: number;
  conversationId: number;
  taskId: number;
  title: string;
  message: string;
  type: Extract<
    NotificationType,
    'BLOCKER_RAISED' | 'BLOCKER_MESSAGE' | 'BLOCKER_RESOLVED'
  >;
}

export async function createNotification(
  input: NewNotification,
  options: { transaction?: Transaction } = {}
) {
  const { transaction } = options;

  const notification = await Notification.create(
    { ...input, data: input.data ?? {} },
    { transaction }
  );

  const emit = () => {
    try {
      getIO()
        .to(`user:${input.user_id}`)
        .emit('notification:new', notification.toJSON());
    } catch (err) {
      // A failed push must never break the main request
      console.error('Socket emit failed:', err);
    }
  };

  // Inside a transaction, push only after it commits
  if (transaction) transaction.afterCommit(emit);
  else emit();

  return notification;
}

/** Run a notification without letting its failure break the caller. */
export async function safeNotify(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error('Notification failed:', err);
  }
}

/* ---------- Mentee notifications ---------- */
export const notifyTaskAssigned = (
  mentee_id: number,
  task: TaskRef,
  assignerName: string,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentee_id,
      type: 'TASK_ASSIGNED',
      title: 'New task assigned',
      message: `${assignerName} assigned you "${task.title}"`,
      data: { taskId: task.id },
    },
    { transaction: tx }
  );

// ---------- Due date reminders ----------
export type DueReminderKind = '24h' | '1h';

function formatDueDate(date: Date): string {
  return new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  });
}

export const notifyTaskDueDate = (
  mentee_id: number,
  task: TaskRef,
  dueDate: Date,
  kind: DueReminderKind = '24h',
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentee_id,
      type: 'TASK_DUE_DATE',
      title: kind === '1h' ? 'Task due within 1 hour' : 'Task due within 24 hours',
      message: `"${task.title}" is due on ${formatDueDate(dueDate)}`,
      data: {
        taskId: task.id,
        dueDate: new Date(dueDate).toISOString(),
        reminder: kind,
      },
    },
    { transaction: tx }
  );

export const notifyTaskChangeRequest = (
  mentee_id: number,
  task: TaskRef,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentee_id,
      type: 'TASK_CHANGE_REQUEST',
      title: 'Changes requested',
      message: `Your mentor requested changes on "${task.title}"`,
      data: { taskId: task.id },
    },
    { transaction: tx }
  );

export const notifyEvaluationSubmitted = (
  mentee_id: number,
  task: TaskRef,
  score?: number | null,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentee_id,
      type: 'EVALUATION_SUBMITTED',
      title: 'Task evaluated',
      message: `Your task "${task.title}" was evaluated.`,
      data: { taskId: task.id },
    },
    { transaction: tx }
  );

  
/* ---------- Mentor notifications ---------- */
export const notifyTaskUpdated = (
  mentor_id: number,
  task: TaskRef,
  actorName: string,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentor_id,
      type: 'TASK_UPDATED',
      title: 'Task updated',
      message: `${actorName} updated "${task.title}"`,
      data: { taskId: task.id },
    },
    { transaction: tx }
  );

export const notifyTaskSubmitted = (
  mentor_id: number,
  task: TaskRef,
  menteeName: string,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentor_id,
      type: 'TASK_SUBMITTED',
      title: 'Task submitted',
      message: `${menteeName} submitted "${task.title}" for review`,
      data: { taskId: task.id },
    },
    { transaction: tx }
  );

export const notifyTaskStatusChanged = (
  mentor_id: number,
  task: TaskRef,
  menteeName: string,
  status: string,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentor_id,
      type: 'TASK_STATUS_CHANGED',
      title: 'Task status changed',
      message: `${menteeName} moved "${task.title}" to ${status}`,
      data: { taskId: task.id, status },
    },
    { transaction: tx }
  );

  export const notifyMentorTaskDueDate = (
  mentor_id: number,
  menteeName: string,
  task: TaskRef,
  dueDate: Date,
  kind: DueReminderKind = '24h',
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: mentor_id,
      type: 'TASK_DUE_DATE',
      title: kind === '1h'
        ? 'Mentee task due within 1 hour'
        : 'Mentee task due within 24 hours',

      message: `${menteeName}'s task "${task.title}" is due on ${formatDueDate(dueDate)}`,

      data: {
        taskId: task.id,
        menteeName,
        dueDate: new Date(dueDate).toISOString(),
        reminder: kind,
      },
    },
    { transaction: tx }
  );

/* ---------- Read side (used by the controller) ---------- */
export const listNotifications = (user_id: number, limit: number, offset: number) =>
  Notification.findAll({
    where: { user_id },
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

export const getUnreadCount = (user_id: number) =>
  Notification.count({ where: { user_id, is_read: false } });

export async function markRead(user_id: number, id: number) {
  const [affected] = await Notification.update(
    { is_read: true },
    { where: { id, user_id } }
  );
  return affected;
}

export async function markAllRead(user_id: number) {
  const [affected] = await Notification.update(
    { is_read: true },
    { where: { user_id, is_read: false } }
  );
  return affected;
}


/*---------------Notification that is same in both--------------------------------*/
export const notifyNewMessage = (
  recipientId: number,
  groupId: number,
  groupName: string,
  senderId: number,
  senderName: string,
  messageId: number,
  message: string,
  tx?: Transaction
) =>
  createNotification(
    {
      user_id: recipientId,
      type: 'NEW_MESSAGE',
      title: `New message in ${groupName}`,
       message: `${senderName}: ${message}`,
    data: {
      groupId,
      groupName,
      senderId,
      senderName,
      messageId,
    },
    },
    { transaction: tx }
  );


  export const notifyGroupCreated = async (
  userId: number,
  groupId: number,
  groupName: string
) => {
  return createNotification({
    user_id: userId,
    type: 'GROUP_CREATED',
    title: 'New Group Created',
    message: `You have been added to the group "${groupName}".`,
    data: {
      groupId,
      groupName,
    },
  });
};

export const notifyMemberAddedToGroup = async (
  userId: number,
  groupId: number,
  groupName: string
) => {
  return createNotification({
    user_id: userId,
    type: 'ADDED_TO_GROUP',
    title: 'Added to Group',
    message: `You have been added to the group "${groupName}".`,
    data: {
      groupId,
      groupName,
    },
  });
};


export const createBlockerNotification = (
  data: BlockerNotificationData,
  transaction?: Transaction
) =>
  createNotification(
    {
      user_id: data.recipientId,
      type: data.type,
      title: data.title,
      message: data.message,
      data: {
        senderId: data.senderId,
        conversationId: data.conversationId,
        taskId: data.taskId,
      },
    },
    { transaction }
  );