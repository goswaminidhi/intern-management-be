import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/database';

export type UserRole = 'admin' | 'mentee' | 'mentor';
export type UserStatus = 'active' | 'inactive';

class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare assigned_to: CreationOptional<string | null>;
  declare mentor_id: CreationOptional<number | null>;
  declare password: string;
  declare role: CreationOptional<UserRole>;
  declare joined: CreationOptional<Date>;
  declare status: CreationOptional<UserStatus>;
  declare firstLogin: CreationOptional<boolean>;
  declare on_Board: CreationOptional<boolean>;
  declare assignedMentees: CreationOptional<(string | number)[]>;

  // Self-referential associations (Mentor <-> Mentees)
  declare mentor?: NonAttribute<User | null>;
  declare mentees?: NonAttribute<User[]>;

  // Timestamps
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    assigned_to: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    mentor_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    assignedMentees: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    on_Board:{
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    role: {
      type: DataTypes.ENUM('admin', 'mentee', 'mentor'),
      allowNull: false,
      defaultValue: 'admin',
    },
    joined: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    },
    firstLogin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
    defaultScope: {
      attributes: { exclude: ['password'] },
    },
  }
);

export default User;
export type UserAttributes = InferAttributes<User>;