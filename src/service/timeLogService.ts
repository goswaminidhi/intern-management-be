import { Transaction, Op } from 'sequelize';
import { sequelize } from '../config/database';
import Task from '../models/tasks';
import TaskTimeLog from '../models/taskTimeLog';
import { initAssociations } from '../models/associations';

initAssociations();

export const MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Finds and auto-closes any active timer logs that have exceeded the 8-hour limit.
 * Sets ended_at to started_at + 8h, auto_closed to true, and increments actual_seconds on Task.
 */
export async function closeStaleLogs(whereCondition: Record<string, any> = {}) {
  const cutoff = new Date(Date.now() - MAX_SESSION_MS);
  const staleLogs = await TaskTimeLog.findAll({
    where: {
      ...whereCondition,
      ended_at: null,
      started_at: { [Op.lte]: cutoff },
    },
  });

  for (const log of staleLogs) {
    await sequelize.transaction(async (t) => {
      await closeLog(log, t, {
        endedAt: new Date(log.started_at.getTime() + MAX_SESSION_MS),
        autoClosed: true,
      });
    });
  }

  return staleLogs.length;
}

export async function startTimer(taskId: number, userId: number) {
  // Auto-close any expired (>8h) sessions first
  await closeStaleLogs({ user_id: userId });

  return sequelize.transaction(async (t) => {
    const task = await Task.findByPk(taskId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!task) throw new HttpError(404, 'Task not found');
    if (task.mentee_id !== userId) throw new HttpError(403, 'Not your task');
    if (['complete', 'submitted', 'blocker', 'hold'].includes(task.status)) {
      throw new HttpError(400, `Cannot track time on a ${task.status} task`);
    }

    const active = await TaskTimeLog.findOne({
      where: { user_id: userId, ended_at: null },
      transaction: t,
    });
    if (active) throw new HttpError(409, 'You already have a running timer');

    if (task.status === 'needs-revision') {
      await task.update({ status: 'in-progress' }, { transaction: t });
    }

    return TaskTimeLog.create(
      { task_id: taskId, user_id: userId, started_at: new Date() },
      { transaction: t }
    );
  });
}

export async function getActiveTimer(userId: number) {
  // Check and close any timer exceeding 8 hours
  await closeStaleLogs({ user_id: userId });

  const log = await TaskTimeLog.findOne({
    where: { user_id: userId, ended_at: null },
    include: [{ model: Task, as: 'task', attributes: ['id', 'title'] }],
  });
  if (!log) return null;

  return {
    ...log.toJSON(),
    elapsed_seconds: Math.max(
      0,
      Math.round((Date.now() - log.started_at.getTime()) / 1000)
    ),
  };
}

export async function closeLog(
  log: TaskTimeLog,
  t: Transaction,
  opts: { endedAt?: Date; autoClosed?: boolean; note?: string } = {}
) {
  const endedAt = opts.endedAt ?? new Date();
  const seconds = Math.max(
    0,
    Math.round((endedAt.getTime() - log.started_at.getTime()) / 1000)
  );

  await log.update(
    {
      ended_at: endedAt,
      duration_seconds: seconds,
      auto_closed: opts.autoClosed ?? false,
      ...(opts.note !== undefined && { note: opts.note }),
    },
    { transaction: t }
  );

  await Task.increment('actual_seconds', {
    by: seconds,
    where: { id: log.task_id },
    transaction: t,
  });

  return log;
}

export async function stopTimer(taskId: number, userId: number, note?: string) {
  return sequelize.transaction(async (t) => {
    const log = await TaskTimeLog.findOne({
      where: { task_id: taskId, user_id: userId, ended_at: null },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!log) throw new HttpError(404, 'No running timer for this task');
    return closeLog(log, t, { note });
  });
}

// Call this inside your existing status-change transactions
export async function closeActiveLogForTask(taskId: number, t?: Transaction) {
  const closeAll = async (tx: Transaction) => {
    const activeLogs = await TaskTimeLog.findAll({
      where: { task_id: taskId, ended_at: null },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    for (const active of activeLogs) {
      await closeLog(active, tx);
    }
  };

  if (t) {
    await closeAll(t);
  } else {
    await sequelize.transaction(async (tx) => {
      await closeAll(tx);
    });
  }
}

// Call this when a user logs out so any running timer is stopped
export async function closeActiveLogForUser(userId: number, t?: Transaction) {
  const closeAll = async (tx: Transaction) => {
    const activeLogs = await TaskTimeLog.findAll({
      where: { user_id: userId, ended_at: null },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    for (const active of activeLogs) {
      await closeLog(active, tx);
    }
  };

  if (t) {
    await closeAll(t);
  } else {
    await sequelize.transaction(async (tx) => {
      await closeAll(tx);
    });
  }
}

export async function getTaskTimeSummary(taskId: number) {
  // Auto-close any expired (>8h) sessions on this task
  await closeStaleLogs({ task_id: taskId });

  const logs = await TaskTimeLog.findAll({
    where: { task_id: taskId },
    order: [['started_at', 'DESC']],
  });
  const closedSeconds = logs.reduce((s, l) => s + (l.duration_seconds ?? 0), 0);
  const running = logs.find((l) => l.ended_at === null) ?? null;
  const runningSeconds = running
    ? Math.round((Date.now() - running.started_at.getTime()) / 1000)
    : 0;

  return {
    logs,
    closedSeconds,
    running,
    totalSeconds: closedSeconds + runningSeconds,
  };
}