import {
  DataTypes,
  Model,
  Optional
} from 'sequelize';

import { sequelize } from '../config/database';

export type SubmissionStatus =
  | 'submitted'
  | 'changes_requested'
  | 'approved';

export interface TaskSubmissionAttributes {
  id: number;
  taskId: number;
  submittedBy: number;
  version: number;
  submissionText: string;
  submissionUrl?: string | null;
  demoUrl?: string | null;
  attachmentUrl?: string | null;
  status: SubmissionStatus;
  mentorFeedback?: string | null;
  reviewedBy?: number | null;
  reviewedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TaskSubmissionCreationAttributes
  extends Optional<
    TaskSubmissionAttributes,
    | 'id'
    | 'submissionUrl'
    | 'demoUrl'
    | 'attachmentUrl'
    | 'status'
    | 'mentorFeedback'
    | 'reviewedBy'
    | 'reviewedAt'
  > {}

class TaskSubmission
  extends Model<
    TaskSubmissionAttributes,
    TaskSubmissionCreationAttributes
  >
  implements TaskSubmissionAttributes {

  declare id: number;
  declare taskId: number;
  declare submittedBy: number;
  declare version: number;
  declare submissionText: string;
  declare submissionUrl: string | null;
  declare demoUrl: string | null;
  declare attachmentUrl: string | null;
  declare status: SubmissionStatus;
  declare mentorFeedback: string | null;
  declare reviewedBy: number | null;
  declare reviewedAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

TaskSubmission.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },

    taskId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    submittedBy: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    version: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    submissionText: {
      type: DataTypes.TEXT,
      allowNull: false
    },

    submissionUrl: {
      type: DataTypes.STRING(1000),
      allowNull: true
    },

    demoUrl: {
      type: DataTypes.STRING(1000),
      allowNull: true
    },

    attachmentUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },

    status: {
      type: DataTypes.ENUM(
        'submitted',
        'changes_requested',
        'approved'
      ),
      defaultValue: 'submitted',
      allowNull: false
    },

    mentorFeedback: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    reviewedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'task_submissions',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['taskId', 'version']
      }
    ]
  }
);

export default TaskSubmission;