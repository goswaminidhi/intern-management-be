import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

// ---------- Group ----------
export class ChatGroup extends Model {
  declare id: number;
  declare name: string;
  declare description: string | null;
  declare taskId: number | null; // optional link to a task
  declare createdBy: number | null;
  declare status: 'active' | 'archived'; // archived = read-only
  declare createdAt: Date;
}

ChatGroup.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    description: { type: DataTypes.STRING(500), allowNull: true },
    taskId: { type: DataTypes.INTEGER, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
  },
  { sequelize, tableName: 'chat_groups' }
);

// ---------- Membership ----------
// One row per (group, user). Leaving/removal sets leftAt instead of deleting,
// so there is an audit trail and re-adding someone just reactivates the row.
export class ChatMember extends Model {
  declare id: number;
  declare groupId: number;
  declare userId: number;
  declare role: 'owner' | 'member';
  declare joinedAt: Date;
  declare leftAt: Date | null;
  declare leftReason: string | null; // removed | task_unassigned | user_deleted
  declare lastReadMessageId: number | null;
}

ChatMember.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    groupId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    role: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'member' },
    joinedAt: { type: DataTypes.DATE, allowNull: false },
    leftAt: { type: DataTypes.DATE, allowNull: true },
    leftReason: { type: DataTypes.STRING(30), allowNull: true },
    lastReadMessageId: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, tableName: 'chat_members' }
);

// ---------- Message ----------
// senderName is a snapshot, so history still reads correctly after a user is deleted.
// Deleted messages keep their row (history/ordering) but body is erased.
export class ChatMessage extends Model {
  declare id: number;
  declare groupId: number;
  declare senderId: number | null; // null for system messages
  declare senderName: string;
  declare type: 'text' | 'file' | 'system';
  declare body: string | null;
  declare deletedAt: Date | null;
  declare deletedBy: number | null;
  declare createdAt: Date;
}

ChatMessage.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    groupId: { type: DataTypes.INTEGER, allowNull: false },
    senderId: { type: DataTypes.INTEGER, allowNull: true },
    senderName: { type: DataTypes.STRING(120), allowNull: false },
    type: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'text' },
    body: { type: DataTypes.TEXT, allowNull: true },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
    deletedBy: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, tableName: 'chat_messages' }
);

// ---------- Attachment ----------
// ---------- Attachment ----------
export class ChatAttachment extends Model {
  declare id: number;
  declare messageId: number;
  declare originalName: string | null;
  declare storedName: string | null; // retained for backward compatibility / fallback
  declare fileId: string | null;     // ImageKit file ID (used for deletion)
  declare url: string | null;        // ImageKit direct CDN URL
  declare mimeType: string;
  declare size: number;
  declare deletedAt: Date | null;
}

ChatAttachment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    messageId: { type: DataTypes.INTEGER, allowNull: false },
    originalName: { type: DataTypes.STRING(255), allowNull: true },
    storedName: { type: DataTypes.STRING(255), allowNull: true },
    fileId: { type: DataTypes.STRING(100), allowNull: true },
    url: { type: DataTypes.STRING(1000), allowNull: true },
    mimeType: { type: DataTypes.STRING(100), allowNull: false },
    size: { type: DataTypes.INTEGER, allowNull: false },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'chat_attachments' }
);