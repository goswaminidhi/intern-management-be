import { Transaction } from 'sequelize';

import { sequelize } from '../config/database';
import Task from '../models/tasks';
import TaskSubmission from '../models/taskSubmission';
import User from '../models/user';
import {
  notifyTaskSubmitted,
  notifyTaskChangeRequest,
  notifyEvaluationSubmitted,
  safeNotify,
} from './notificationService';
import { closeActiveLogForTask } from './timeLogService';

interface SubmitTaskInput {
  taskId: number;
  submittedBy: number;
  submissionText: string;
  submissionUrl?: string | null;
  demoUrl?: string | null;
  attachmentUrl?: string | null;
}

interface ReviewInput {
  submissionId: number;
  mentorId: number;
  feedback?: string;
}

async function canMentorAccessTask(mentorId: number, task: Task): Promise<boolean> {
  if (Number(task.get('assigned_by')) === Number(mentorId)) {
    return true;
  }
  const menteeId = Number(task.get('mentee_id'));
  const mentee = await User.findByPk(menteeId);
  if (mentee && Number(mentee.mentor_id) === Number(mentorId)) {
    return true;
  }
  const mentor = await User.findByPk(mentorId);
  if (mentor && Array.isArray(mentor.assignedMentees)) {
    const list = mentor.assignedMentees.map(Number);
    if (list.includes(menteeId)) {
      return true;
    }
  }
  return false;
}

// -------------------------------------
// 1. SUBMIT OR RESUBMIT TASK
// -------------------------------------

export const submitTask = async (
  input: SubmitTaskInput
) => {

  const transaction = await sequelize.transaction();

  try {

    const {
      taskId,
      submittedBy,
      submissionText,
      submissionUrl,
      demoUrl,
      attachmentUrl
    } = input;

    if (!submissionText?.trim()) {
      throw new Error('Submission description is required');
    }

    const task = await Task.findByPk(taskId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!task) {
      throw new Error('Task not found');
    }

    // Verify that the task belongs to this mentee.
    // Adjust assignedTo if your Task model uses another field.
    if (Number(task.get('mentee_id')) !== submittedBy) {
      throw new Error('You are not assigned to this task');
    }

    const latestSubmission = await TaskSubmission.findOne({
      where: { taskId },
      order: [['version', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    let nextVersion = 1;

    if (latestSubmission) {

      if (latestSubmission.status === 'approved') {
        throw new Error(
          'This task has already been approved'
        );
      }

      if (latestSubmission.status !== 'changes_requested') {
        throw new Error(
          'Your previous submission is still awaiting review'
        );
      }

      nextVersion = latestSubmission.version + 1;
    }

    const newSubmission = await TaskSubmission.create(
      {
        taskId,
        submittedBy,
        version: nextVersion,
        submissionText,
        submissionUrl: submissionUrl || null,
        demoUrl: demoUrl || null,
        attachmentUrl: attachmentUrl || null,
        status: 'submitted'
      },
      { transaction }
    );
    await task.update(
      {
        status: 'submitted',
        submission_url: submissionUrl || (attachmentUrl && !attachmentUrl.includes('ik.imagekit.io') ? attachmentUrl : task.submission_url),
        demo_url: demoUrl || task.demo_url,
        submission_notes: submissionText,
        submitted_at: new Date(),
      },
      { transaction }
    );

    // Automatically close any running timer on this task
    await closeActiveLogForTask(taskId, transaction);

    // Notify the assigned mentor
    const mentee = await User.findByPk(submittedBy, { transaction });
    await safeNotify(() =>
      notifyTaskSubmitted(
        Number(task.get('assigned_by')),
        {
          id: Number(task.id),
          title: String(task.get('title')),
        },
        String(mentee?.get('name') || 'A mentee'),
        transaction
      )
    );
    await transaction.commit();

    // TODO: Notify the assigned mentor about the new submission.
   
    // Integrate this with your existing notification service.

    return {
      message: 'Task submitted successfully',
      submission: newSubmission
    };

  } catch (error) {

    await transaction.rollback();
    throw error;
  }
};


  
// -------------------------------------
// 2. MENTOR REQUESTS CHANGES
// -------------------------------------

export const requestChanges = async (
  input: ReviewInput
) => {
  const { submissionId, mentorId, feedback } = input;

  if (!feedback?.trim()) {
    throw new Error('Please provide feedback for the mentee');
  }

  const transaction = await sequelize.transaction();

  try {
    const submission = await TaskSubmission.findByPk(
      submissionId,
      {
        transaction,
        lock: transaction.LOCK.UPDATE
      }
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (submission.status !== 'submitted') {
      throw new Error(
        'Only pending submissions can be reviewed'
      );
    }

    const task = await Task.findByPk(
      submission.taskId,
      {
        transaction,
        lock: transaction.LOCK.UPDATE
      }
    );

    if (!task) {
      throw new Error('Associated task not found');
    }

    // Verify assigned mentor
    const authorized = await canMentorAccessTask(Number(mentorId), task);
    if (!authorized) {
      throw new Error(
        'You are not authorized to review this task'
      );
    }

    // Update submission record
    submission.status = 'changes_requested';
    submission.mentorFeedback = feedback.trim();
    submission.reviewedBy = mentorId;
    submission.reviewedAt = new Date();

    await submission.save({ transaction });

    // Update main task record
    await task.update(
      {
        status: 'needs-revision'
      },
      { transaction }
    );

    await safeNotify(() =>
      notifyEvaluationSubmitted(
        Number(task.get('mentee_id')),
        {
          id: Number(task.id),
          title: String(task.get('title')),
        },
        null,
        transaction
      )
    );
    await transaction.commit();

    return {
      message: 'Changes requested successfully',
      submission
    };

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};


// -------------------------------------
// 3. MENTOR APPROVES SUBMISSION
// -------------------------------------

export const approveSubmission = async (
  input: ReviewInput
) => {

  const { submissionId, mentorId } = input;

  const transaction = await sequelize.transaction();

  try {

    const submission = await TaskSubmission.findByPk(
      submissionId,
      {
        transaction,
        lock: transaction.LOCK.UPDATE
      }
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (submission.status !== 'submitted') {
      throw new Error(
        'Only pending submissions can be approved'
      );
    }

    const task = await Task.findByPk(
      submission.taskId,
      { transaction }
    );

    if (!task) {
      throw new Error('Task not found');
    }

    const authorized = await canMentorAccessTask(Number(mentorId), task);
    if (!authorized) {
      throw new Error(
        'You are not authorized to approve this task'
      );
    }

    // Ensure this is the latest version.
    const latestSubmission = await TaskSubmission.findOne({
      where: { taskId: submission.taskId },
      order: [['version', 'DESC']],
      transaction
    });

    if (
      !latestSubmission ||
      latestSubmission.id !== submission.id
    ) {
      throw new Error(
        'Only the latest submission can be approved'
      );
    }

   // Update submission status
      submission.status = 'approved';
      submission.reviewedBy = mentorId;
      submission.reviewedAt = new Date();

      await submission.save({ transaction });

      // Update the main task status
      await task.update(
        {
          status: 'complete'
        },
        { transaction }
      );

      // Automatically close any running timer on this task
      await closeActiveLogForTask(Number(task.id), transaction);

    // TODO: Update your main Task status if required.
    // Notify the mentee about approval
      await safeNotify(() =>
      notifyEvaluationSubmitted(
        Number(task.get('mentee_id')),
        {
          id: Number(task.id),
          title: String(task.get('title')),
        },
        null,
        transaction
      )
    );

    // Commit both updates together
      await transaction.commit();
      
    return {
      message: 'Task approved successfully',
      submission
    };

  } catch (error) {

    await transaction.rollback();
    throw error;
  }
};

// -------------------------------------
// 4. GET COMPLETE SUBMISSION HISTORY
// -------------------------------------

export const getSubmissionHistory = async (
  taskId: number,
  userId: number,
  role: string
) => {
  const task = await Task.findByPk(taskId);

  if (!task) {
    throw new Error('Task not found');
  }

  const menteeId = Number(task.get('mentee_id'));
  const mentorId = Number(task.get('assigned_by'));

  // Mentee can access only their own task history
  if (role === 'mentee' && menteeId !== Number(userId)) {
    throw new Error('You cannot access this task history');
  }

  // Mentor can access tasks assigned by them OR tasks of their assigned mentees
  if (role === 'mentor') {
    const authorized = await canMentorAccessTask(Number(userId), task);
    if (!authorized) {
      throw new Error('You cannot access this task history');
    }
  }

  if (!['admin', 'mentor', 'mentee'].includes(role)) {
    throw new Error('Unauthorized access');
  }

  const submissions = await TaskSubmission.findAll({
    where: { taskId },

    include: [
      {
        model: User,
        as: 'submitter',
        attributes: ['id', 'name', 'email']
      },
      {
        model: User,
        as: 'reviewer',
        attributes: ['id', 'name', 'email'],
        required: false
      }
    ],

    order: [['version', 'ASC']]
  });

  return {
    taskId,
    totalVersions: submissions.length,
    submissions
  };
};

// -------------------------------------
// 5. GET INDIVIDUAL SUBMISSION
// -------------------------------------

export const getSubmissionById = async (
  submissionId: number,
  userId: number,
  role: string
) => {

  const submission = await TaskSubmission.findByPk(
    submissionId
  );

  if (!submission) {
    throw new Error('Submission not found');
  }

  const task = await Task.findByPk(submission.taskId);

  if (!task) {
    throw new Error('Associated task not found');
  }

  const menteeId = Number(task.get('mentee_id'));
  const assignedBy = Number(task.get('assigned_by'));

  // Mentee can access their own assigned task.
  if (role === 'mentee' && menteeId !== Number(userId)) {
    throw new Error('You cannot access this submission');
  }

  // Mentor can access tasks assigned to them OR tasks of their assigned mentees.
  if (role === 'mentor') {
    const authorized = await canMentorAccessTask(Number(userId), task);
    if (!authorized) {
      throw new Error('You cannot access this submission');
    }
  }

  if (!['admin', 'mentor', 'mentee'].includes(role)) {
    throw new Error('Unauthorized access');
  }

  const result = await TaskSubmission.findByPk(
    submissionId,
    {
      include: [
        {
          model: User,
          as: 'submitter',
          attributes: ['id', 'name', 'email']
        },
        {
          model: User,
          as: 'reviewer',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ]
    }
  );

  return result;
};