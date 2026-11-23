
import {
  Model,
  DataTypes,
  Optional,
} from 'sequelize';

import {sequelize} from '../config/database';

// Attributes
interface TaskBlockerMessageAttributes {
  id: number;
  conversationId: number;
  senderId: number;
  message: string;
  createdAt?: Date;
}

// Fields that are optional during creation
interface TaskBlockerMessageCreationAttributes
  extends Optional<
    TaskBlockerMessageAttributes,
    'id' | 'createdAt'
  > {}

// Model class
class TaskBlockerMessage
  extends Model<
    TaskBlockerMessageAttributes,
    TaskBlockerMessageCreationAttributes
  >
  implements TaskBlockerMessageAttributes {

  public id!: number;
  public conversationId!: number;
  public senderId!: number;
  public message!: string;

  public readonly createdAt!: Date;
}

// Initialize model
TaskBlockerMessage.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    conversationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    senderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'TaskBlockerMessage',
    tableName: 'TaskBlockerMessages',
    timestamps: true,
    updatedAt: false,
  }
);

export default TaskBlockerMessage;
