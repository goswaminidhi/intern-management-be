
import {
  Model,
  DataTypes,
  Optional,
} from 'sequelize';

import { sequelize } from '../config/database';

// Attributes
interface TaskBlockerConversationAttributes {
  id: number;
  taskId: number;
  menteeId: number;
  mentorId: number;
  status: 'open' | 'resolved';
  createdAt?: Date;
  updatedAt?: Date;
}

// Fields that are optional during creation
interface TaskBlockerConversationCreationAttributes
  extends Optional<
    TaskBlockerConversationAttributes,
    'id' | 'status' | 'createdAt' | 'updatedAt'
  > {}

// Model class
class TaskBlockerConversation
  extends Model<
    TaskBlockerConversationAttributes,
    TaskBlockerConversationCreationAttributes
  >
  implements TaskBlockerConversationAttributes {

  public id!: number;
  public taskId!: number;
  public menteeId!: number;
  public mentorId!: number;
  public status!: 'open' | 'resolved';

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Initialize model
TaskBlockerConversation.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    taskId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    menteeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    mentorId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM('open', 'resolved'),
      allowNull: false,
      defaultValue: 'open',
    },
  },
  {
    sequelize,
    modelName: 'TaskBlockerConversation',
    tableName: 'TaskBlockerConversations',
    timestamps: true,
  }
);

export default TaskBlockerConversation;
