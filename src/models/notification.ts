import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
} from "sequelize";
import { sequelize } from "../config/database";
import type User from "./user";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_UPDATED"
  | "TASK_SUBMITTED"
  | "TASK_DUE_DATE"
  | "TASK_STATUS_CHANGED"
  | "TASK_CHANGE_REQUEST"
  | "EVALUATION_SUBMITTED"
  | "NEW_MESSAGE"
  | 'GROUP_CREATED'
  | 'ADDED_TO_GROUP'
  | "BLOCKER_RAISED"
  | "BLOCKER_MESSAGE"
  | "BLOCKER_RESOLVED"

export class Notification extends Model<
  InferAttributes<Notification>,
  InferCreationAttributes<Notification>
> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<User["id"]>;
  declare type: NotificationType;
  declare title: string;
  declare message: string;
  declare data: CreationOptional<Record<string, unknown>>;
  declare is_read: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
}

Notification.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      get() {
        return Number(this.getDataValue("id"));
      },
    },
    user_id: { 
      type: DataTypes.INTEGER, 
      allowNull: false 
    }, // no `field: "id"`
    type: { 
      type: DataTypes.STRING(50), 
      allowNull: false 
    },
    title: { 
      type: DataTypes.STRING(150),
       allowNull: false },
    message: { 
      type: DataTypes.TEXT, 
      allowNull: false },
    data: { 
      type: DataTypes.JSONB, 
      allowNull: false, defaultValue: {} 
    },
    is_read: { 
      type: DataTypes.BOOLEAN, 
      allowNull: false, 
      defaultValue: false },
    created_at: { 
      type: DataTypes.DATE 
    },
  },
  {
    sequelize,
    tableName: "notifications",
    modelName: "Notification",
    timestamps: true,
    createdAt: "created_at", // use your attribute instead of adding createdAt
    updatedAt: false,
  }
);