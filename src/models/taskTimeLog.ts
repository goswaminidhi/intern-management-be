import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/database';
import type Task from './tasks';
import type User from './user';

class TaskTimeLog extends Model<
  InferAttributes<TaskTimeLog>,
  InferCreationAttributes<TaskTimeLog>
> {
  declare id: CreationOptional<number>;
  declare task_id: number;
  declare user_id: number;
  declare started_at: Date;
  declare ended_at: CreationOptional<Date | null>;
  declare duration_seconds: CreationOptional<number | null>;
  declare auto_closed: CreationOptional<boolean>;
  declare note: CreationOptional<string | null>;

  declare task?: NonAttribute<Task>;
  declare user?: NonAttribute<User>;

  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

TaskTimeLog.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    task_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    started_at: { type: DataTypes.DATE, allowNull: false },
    ended_at: { type: DataTypes.DATE, allowNull: true },
    duration_seconds: { type: DataTypes.INTEGER, allowNull: true },
    auto_closed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'task_time_logs',
    modelName: 'TaskTimeLog',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['task_id'] },
      { fields: ['user_id', 'ended_at'] },
      // Postgres only: DB-level guarantee of one running timer per user
      // { unique: true, fields: ['user_id'], where: { ended_at: null } },
    ],
  }
);

export default TaskTimeLog;