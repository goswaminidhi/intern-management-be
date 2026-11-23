import User from './user';
import Task from './tasks';
import PasswordReset from './resetPassword';
import RefreshToken from './refreshToken';
import { Notification } from './notification';
import TaskSubmission from './taskSubmission';
import TaskTimeLog from './taskTimeLog';
import TaskBlockerConversation from './taskBlockerConversation';
import TaskBlockerMessage from './taskBlockerMessage';

let initialized = false;

/** Register Sequelize model associations once across the application. */
export function initAssociations(): void {
  if (initialized) return;

  // User self-referencing associations
  User.belongsTo(User, {
    as: 'mentor',
    foreignKey: 'mentor_id',
  });

  User.hasMany(User, {
    as: 'mentees',
    foreignKey: 'mentor_id',
  });

  // Task associations
  User.hasMany(Task, { as: 'assignedTasks', foreignKey: 'mentee_id' });
  User.hasMany(Task, { as: 'createdTasks', foreignKey: 'assigned_by' });
  User.hasMany(Task, { as: 'evaluatedTasks', foreignKey: 'evaluated_by' });

  Task.belongsTo(User, { as: 'mentee', foreignKey: 'mentee_id' });
  Task.belongsTo(User, { as: 'assigner', foreignKey: 'assigned_by' });
  Task.belongsTo(User, { as: 'evaluator', foreignKey: 'evaluated_by' });

  // Password reset associations
  User.hasMany(PasswordReset, { as: 'passwordResets', foreignKey: 'userId' });
  PasswordReset.belongsTo(User, { as: 'user', foreignKey: 'userId' });

  // Refresh token associations
  User.hasMany(RefreshToken, { as: 'refreshTokens', foreignKey: 'userId' });
  RefreshToken.belongsTo(User, { as: 'user', foreignKey: 'userId' });

  // Notification associations
  User.hasMany(Notification, {
    as: 'notifications',
    foreignKey: 'user_id',
    onDelete: 'CASCADE',
  });

  Notification.belongsTo(User, { as: 'user', foreignKey: 'user_id' });

  // Task submission associations
  Task.hasMany(TaskSubmission, {
    foreignKey: 'taskId',
    as: 'submissions',
  });

  TaskSubmission.belongsTo(Task, {
    foreignKey: 'taskId',
    as: 'task',
  });

  User.hasMany(TaskSubmission, {
    foreignKey: 'submittedBy',
    as: 'taskSubmissions',
  });

  TaskSubmission.belongsTo(User, {
    foreignKey: 'submittedBy',
    as: 'submitter',
  });

  User.hasMany(TaskSubmission, {
    foreignKey: 'reviewedBy',
    as: 'reviewedSubmissions',
  });

  TaskSubmission.belongsTo(User, {
    foreignKey: 'reviewedBy',
    as: 'reviewer',
  });

  Task.hasMany(TaskTimeLog, { foreignKey: 'task_id', as: 'timeLogs' });
  TaskTimeLog.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
  User.hasMany(TaskTimeLog, { foreignKey: 'user_id', as: 'timeLogs' });
  TaskTimeLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  // =====================================
  // TASK BLOCKER CONVERSATION ASSOCIATIONS
  // =====================================

  // One Task has one blocker conversation
 Task.hasMany(TaskBlockerConversation, {
  foreignKey: 'taskId',
  as: 'blockerConversations',
  onDelete: 'CASCADE',
});

  TaskBlockerConversation.belongsTo(Task, {
    foreignKey: 'taskId',
    as: 'task',
  });

  // =====================================
  // CONVERSATION AND MESSAGE ASSOCIATIONS
  // =====================================

  // One conversation has many messages
  TaskBlockerConversation.hasMany(TaskBlockerMessage, {
    foreignKey: 'conversationId',
    as: 'messages',
    onDelete: 'CASCADE',
  });

  TaskBlockerMessage.belongsTo(TaskBlockerConversation, {
    foreignKey: 'conversationId',
    as: 'conversation',
  });

  // =====================================
  // USER AND CONVERSATION ASSOCIATIONS
  // =====================================

  // Conversation belongs to a mentee
  User.hasMany(TaskBlockerConversation, {
    foreignKey: 'menteeId',
    as: 'raisedBlockers',
  });

  TaskBlockerConversation.belongsTo(User, {
    foreignKey: 'menteeId',
    as: 'mentee',
  });

  // Conversation belongs to a mentor
  User.hasMany(TaskBlockerConversation, {
    foreignKey: 'mentorId',
    as: 'assignedBlockerConversations',
  });

  TaskBlockerConversation.belongsTo(User, {
    foreignKey: 'mentorId',
    as: 'mentor',
  });

  // =====================================
  // USER AND MESSAGE ASSOCIATIONS
  // =====================================

  // One user can send many blocker messages
  User.hasMany(TaskBlockerMessage, {
    foreignKey: 'senderId',
    as: 'sentBlockerMessages',
  });

  TaskBlockerMessage.belongsTo(User, {
    foreignKey: 'senderId',
    as: 'sender',
  });


  initialized = true;
}

export default initAssociations;