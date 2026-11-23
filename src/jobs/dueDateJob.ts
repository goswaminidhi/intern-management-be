import cron from 'node-cron';
import { Op } from 'sequelize';

import Task from '../models/tasks';
import User from '../models/user';

import {
  safeNotify,
  notifyTaskDueDate,
  notifyMentorTaskDueDate,
} from '../service/notificationService';

const HOUR = 60 * 60 * 1000;

const FINISHED_STATUSES = ['submitted', 'complete', 'hold','blocker'];

let running = false;

// Find the mentor assigned to a mentee
async function getAssignedMentor(menteeId: number) {
  const mentee = await User.findByPk(menteeId);

  if (!mentee || !mentee.assigned_to) {
    return null;
  }

  // This assumes assigned_to stores the mentor's name.
  return User.findOne({
    where: {
      name: mentee.assigned_to,
      role: 'mentor',
      status: 'active',
    },
  });
}

// Send notification to both mentee and mentor
async function sendTaskDueNotification(
  task: Task,
  kind: '1h' | '24h'
) {
  // 1. Notify mentee
  await notifyTaskDueDate(
    task.mentee_id,
    task,
    task.due_date,
    kind
  );

  // 2. Find assigned mentor
  const mentor = await getAssignedMentor(task.mentee_id);

  // 3. Notify mentor
  if (mentor) {
    const mentee = await User.findByPk(task.mentee_id);

    if (mentee) {
      await notifyMentorTaskDueDate(
        mentor.id,
        mentee.name,
        task,
        task.due_date,
        kind
      );
    }
  }
}

async function sendDueReminders(): Promise<void> {
  if (running) return;

  running = true;

  try {
    const now = new Date();

    const in1h = new Date(now.getTime() + HOUR);
    const in24h = new Date(now.getTime() + 24 * HOUR);

    // ---------------------------------------
    // 1. Tasks due within the next hour
    // ---------------------------------------

    const dueSoon = await Task.findAll({
      where: {
        due_date: {
          [Op.gt]: now,
          [Op.lte]: in1h,
        },
        status: {
          [Op.notIn]: FINISHED_STATUSES,
        },
        due_reminder_1h_sent: false,
      },
    });

    for (const task of dueSoon) {
      await safeNotify(async () => {
        await sendTaskDueNotification(task, '1h');

        // Prevent duplicate reminders
        await task.update({
          due_reminder_1h_sent: true,
          due_reminder_24h_sent: true,
        });
      });
    }

    // ---------------------------------------
    // 2. Tasks due between 1 and 24 hours
    // ---------------------------------------

    const dueTomorrow = await Task.findAll({
      where: {
        due_date: {
          [Op.gt]: in1h,
          [Op.lte]: in24h,
        },
        status: {
          [Op.notIn]: FINISHED_STATUSES,
        },
        due_reminder_24h_sent: false,
      },
    });

    for (const task of dueTomorrow) {
      await safeNotify(async () => {
        await sendTaskDueNotification(task, '24h');

        await task.update({
          due_reminder_24h_sent: true,
        });
      });
    }
  } catch (err) {
    console.error('Due date job failed:', err);
  } finally {
    running = false;
  }
}

export function startDueDateJob(): void {
  // Run every 1 minutes
  cron.schedule(
    '*/1 * * * *',
    () => {
      void sendDueReminders();
    },
    {
      timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
    }
  );

  // Run once when server starts
  void sendDueReminders();
}