import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface PasswordResetAttributes {
  id: number;
  userId: number;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  resetTokenHash: string | null;
  resetTokenExpiresAt: Date | null;
  usedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

// Fields that are optional when calling PasswordReset.create()
export type PasswordResetCreationAttributes = Optional<
  PasswordResetAttributes,
  | 'id'
  | 'attempts'
  | 'verifiedAt'
  | 'resetTokenHash'
  | 'resetTokenExpiresAt'
  | 'usedAt'
  | 'createdAt'
  | 'updatedAt'
>;

class PasswordReset
  extends Model<PasswordResetAttributes, PasswordResetCreationAttributes>
  implements PasswordResetAttributes
{
  public id!: number;
  public userId!: number;
  public otpHash!: string;
  public expiresAt!: Date;
  public attempts!: number;
  public verifiedAt!: Date | null;
  public resetTokenHash!: string | null;
  public resetTokenExpiresAt!: Date | null;
  public usedAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PasswordReset.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    otpHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    verifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    resetTokenHash: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    resetTokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    usedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'PasswordReset',
    tableName: 'password_resets',
    timestamps: true,
    indexes: [{ fields: ['userId'] }],
  }
);

export default PasswordReset;
