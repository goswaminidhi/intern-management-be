import fs from 'fs/promises';
import path from 'path';
import { Op } from 'sequelize';
import {sequelize} from '../config/database';
import User from '../models/user';
import { uploadToImageKit, bulkDeleteFromImageKit } from './imageKitService';
import { ChatGroup, ChatMember, ChatMessage, ChatAttachment } from '../models/chat';
import {
  emitToGroup,
  emitToUser,
  addUserToGroupRoom,
  removeUserFromGroupRoom,
  disconnectUser,
  getUsersViewingGroup,
} from '../socket';

import {
  notifyNewMessage, 
  safeNotify,
  notifyGroupCreated,
  notifyMemberAddedToGroup,} from "../service/notificationService";
// ---------- Config ----------
export const MIN_GROUP_MEMBERS = 2; // creator + at least 1 other 
export const MAX_BODY_LENGTH = 2000;
export const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'chat'); // NOT served statically

// ---------- Types ----------
export class ChatError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ChatError';
    this.statusCode = statusCode;
  }
}

export interface Actor {
  id: number;
  name: string;
  role: string;
  assignedMentees?: number[];
}

export interface UploadedFile {
  originalname: string;
  filename?: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const canManageRole = (role: string) => role === 'admin' || role === 'mentor';

// ---------- Internal helpers ----------

async function getGroupOrThrow(groupId: number): Promise<ChatGroup> {
  const group = await ChatGroup.findByPk(groupId);
  if (!group) throw new ChatError('Group not found', 404);
  return group;
}

async function getActiveMembership(groupId: number, userId: number) {
  return ChatMember.findOne({ where: { groupId, userId, leftAt: null } });
}

/**
 * THE privacy gate. Every read of conversation data goes through this.
 * Returns 404 (not 403) so outsiders can't discover which groups exist.
 */
async function requireMember(groupId: number, userId: number) {
  const group = await ChatGroup.findByPk(groupId);
  const member = group ? await getActiveMembership(groupId, userId) : null;
  if (!group || !member) throw new ChatError('Group not found', 404);
  return { group, member };
}

/** Admin: any group. Mentor: only groups they own. */
async function requireManager(actor: Actor, groupId: number) {
  if (!canManageRole(actor.role)) {
    throw new ChatError('Only mentors and admins can manage groups', 403);
  }
  const group = await getGroupOrThrow(groupId);
  if (actor.role === 'admin') return { group };

  const member = await getActiveMembership(groupId, actor.id);
  if (!member) throw new ChatError('Group not found', 404);
  if (member.role !== 'owner') throw new ChatError('Only the group owner can do this', 403);
  return { group };
}

async function assertCanAdd(actor: Actor, userIds: number[]) {
  const users = await User.findAll({
    where: { id: { [Op.in]: userIds } },
    attributes: ['id', 'status'],
  });
  if (users.length !== userIds.length) throw new ChatError('One or more users do not exist');
  if (users.some((u) => u.status !== 'active')) {
    throw new ChatError('Deactivated users cannot be added');
  }
  if (actor.role === 'mentor') {
    const allowed = new Set(actor.assignedMentees ?? []);
    if (userIds.some((id) => !allowed.has(id))) {
      throw new ChatError('Mentors can only add their own assigned mentees', 403);
    }
  }
}

async function userNames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const users = await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'] });
  return new Map<number, string>(users.map((u) => [u.id, u.name] as [number, string]));
}

async function loadAttachments(messageIds: number[]): Promise<Map<number, ChatAttachment[]>> {
  const map = new Map<number, ChatAttachment[]>();
  if (!messageIds.length) return map;
  const rows = await ChatAttachment.findAll({ where: { messageId: { [Op.in]: messageIds } } });
  for (const a of rows) {
    const list = map.get(a.messageId) ?? [];
    list.push(a);
    map.set(a.messageId, list);
  }
  return map;
}

/** Shape sent to clients. Deleted messages never leak body/attachments. */
export function serializeMessage(m: ChatMessage, attachments: ChatAttachment[] = []) {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    groupId: m.groupId,
    senderId: m.senderId,
    senderName: m.senderName,
    type: m.type,
    body: deleted ? null : m.body,
    deleted,
    createdAt: m.createdAt,
    attachments: deleted
      ? []
      : attachments
          .filter((a) => !a.deletedAt)
          .map((a) => ({
            id: a.id,
            originalName: a.originalName ?? 'file',
            mimeType: a.mimeType,
            size: a.size,
            url: a.url || `/chat/attachments/${a.id}`, // ImageKit direct URL or legacy endpoint
          })),
  };
}

/** Post a system message ("X was added") and broadcast it. */
async function announce(groupId: number, body: string) {
  const m = await ChatMessage.create({
    groupId,
    senderId: null,
    senderName: 'System',
    type: 'system',
    body,
  });
  emitToGroup(groupId, 'message:new', serializeMessage(m));
}

async function removeFile(storedName: string) {
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(storedName))).catch(() => undefined);
}

export async function cleanupUploadedFiles(_files: any[] = []) {
  // In-memory uploads are discarded automatically; ImageKit deletion handled on failure
}

/** Add or re-activate a membership. Returns true if the user was newly added. */
async function upsertMember(groupId: number, userId: number): Promise<boolean> {
  const existing = await ChatMember.findOne({ where: { groupId, userId } });
  if (existing && !existing.leftAt) return false;

  if (existing) {
    await existing.update({ leftAt: null, leftReason: null, joinedAt: new Date() });
  } else {
    await ChatMember.create({ groupId, userId, role: 'member', joinedAt: new Date() });
  }
  addUserToGroupRoom(userId, groupId);
  emitToUser(userId, 'group:changed', { groupId });
  return true;
}

/** End a membership: history stays, access stops immediately (REST + live socket). */
async function endMembership(member: ChatMember, reason: string) {
  await member.update({ leftAt: new Date(), leftReason: reason });
  removeUserFromGroupRoom(member.userId, member.groupId);
  emitToUser(member.userId, 'group:changed', { groupId: member.groupId });
  emitToGroup(member.groupId, 'group:changed', { groupId: member.groupId });
}

// ==========================================================
// Groups
// ==========================================================

export async function createGroup(
  actor: Actor,
  input: { name: string; description?: string | null; memberIds: number[]; taskId?: number | null }
) {
  if (!canManageRole(actor.role)) {
    throw new ChatError('Only mentors and admins can create groups', 403);
  }

  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== actor.id);
  if (memberIds.length + 1 < MIN_GROUP_MEMBERS) {
    throw new ChatError(
      `A group needs at least ${MIN_GROUP_MEMBERS} members including you.`
    );
  }
  await assertCanAdd(actor, memberIds);

  const group = await sequelize.transaction(async (t) => {
    const g = await ChatGroup.create(
      {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        taskId: input.taskId ?? null,
        createdBy: actor.id,
      },
      { transaction: t }
    );
    const now = new Date();
    await ChatMember.bulkCreate(
      [
        { groupId: g.id, userId: actor.id, role: 'owner', joinedAt: now },
        ...memberIds.map((userId) => ({ groupId: g.id, userId, role: 'member', joinedAt: now })),
      ],
      { transaction: t }
    );
    return g;
  });

  for (const id of [actor.id, ...memberIds]) {
  addUserToGroupRoom(id, group.id);
  emitToUser(id, 'group:changed', { groupId: group.id });
}

// Send notification only to newly added members
await Promise.all(
  memberIds.map((userId) =>
    safeNotify(() =>
      notifyGroupCreated(
        userId,
        group.id,
        group.name
      )
    )
  )
);

await announce(group.id, `${actor.name} created the group`);

return getGroupDetail(actor, group.id);
}

/** Groups the actor is an active member of, with last message + unread count. */
export async function listGroups(actor: Actor) {
  const memberships = await ChatMember.findAll({ where: { userId: actor.id, leftAt: null } });
  if (!memberships.length) return [];

  const byGroup = new Map(memberships.map((m) => [m.groupId, m]));
  const groups = await ChatGroup.findAll({ where: { id: { [Op.in]: [...byGroup.keys()] } } });

  const items = await Promise.all(
    groups.map(async (g) => {
      const member = byGroup.get(g.id)!;
      const [last, unread] = await Promise.all([
        ChatMessage.findOne({ where: { groupId: g.id }, order: [['id', 'DESC']] }),
        ChatMessage.count({
          where: {
            groupId: g.id,
            id: { [Op.gt]: member.lastReadMessageId ?? 0 },
            deletedAt: null,
            senderId: { [Op.ne]: actor.id }, // own + system messages don't count as unread
          },
        }),
      ]);
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        taskId: g.taskId,
        status: g.status,
        myRole: member.role,
        unreadCount: unread,
        lastMessage: last ? serializeMessage(last) : null,
        lastActivityAt: (last?.createdAt ?? g.createdAt).toISOString(),
      };
    })
  );

  return items.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Admin only: group metadata for management with last message preview. */
export async function listAllGroups(actor: Actor) {
  if (actor.role !== 'admin') throw new ChatError('Admins only', 403);
  const groups = await ChatGroup.findAll({ order: [['createdAt', 'DESC']] });
  const mine = new Map(
    (await ChatMember.findAll({ where: { userId: actor.id, leftAt: null } })).map((m) => [m.groupId, m])
  );

  return Promise.all(
    groups.map(async (g) => {
      const last = await ChatMessage.findOne({ where: { groupId: g.id }, order: [['id', 'DESC']] });
      const attachments = last ? await loadAttachments([last.id]) : new Map();
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        taskId: g.taskId,
        status: g.status,
        myRole: mine.get(g.id)?.role ?? null,
        memberCount: await ChatMember.count({ where: { groupId: g.id, leftAt: null } }),
        lastMessage: last ? serializeMessage(last, attachments.get(last.id)) : null,
        lastActivityAt: (last?.createdAt ?? g.createdAt).toISOString(),
      };
    })
  );
}

/** Members can view their group. Admin can view the roster (not messages) of any group. */
export async function getGroupDetail(actor: Actor, groupId: number) {
  const group = await getGroupOrThrow(groupId);
  const mine = await getActiveMembership(groupId, actor.id);
  if (!mine && actor.role !== 'admin') throw new ChatError('Group not found', 404);

  const members = await ChatMember.findAll({
    where: { groupId, leftAt: null },
    order: [['joinedAt', 'ASC']],
  });
  const users = await User.findAll({
    where: { id: { [Op.in]: members.map((m) => m.userId) } },
    attributes: ['id', 'name', 'email', 'role'],
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    taskId: group.taskId,
    status: group.status,
    createdBy: group.createdBy,
    myRole: mine?.role ?? null,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      name: byId.get(m.userId)?.name ?? 'Unknown user',
      email: byId.get(m.userId)?.email ?? '',
      userRole: byId.get(m.userId)?.role ?? '',
    })),
  };
}
export async function addMembers(
  actor: Actor,
  groupId: number,
  userIds: number[]
) {
  const { group } = await requireManager(actor, groupId);

  if (group.status !== 'active') {
    throw new ChatError('This group is archived', 409);
  }

  const ids = [...new Set(userIds)];

  await assertCanAdd(actor, ids);

  const added: number[] = [];

  for (const id of ids) {
    if (await upsertMember(groupId, id)) {
      added.push(id);
    }
  }

  if (added.length) {
    const names = await userNames(added);

    emitToGroup(groupId, 'group:changed', { groupId });

    // Notify only newly added members
    await Promise.all(
      added.map((userId) =>
        safeNotify(() =>
          notifyMemberAddedToGroup(
            userId,
            groupId,
            group.name
          )
        )
      )
    );

    await announce(
      groupId,
      `${actor.name} added ${added
        .map((id) => names.get(id) ?? 'a user')
        .join(', ')}`
    );
  }

  return getGroupDetail(actor, groupId);
}

export async function removeMember(actor: Actor, groupId: number, targetUserId: number) {
  const { group } = await requireManager(actor, groupId);
  if (group.status !== 'active') throw new ChatError('This group is archived', 409);

  const target = await getActiveMembership(groupId, targetUserId);
  if (!target) throw new ChatError('Member not found', 404);
  if (target.role === 'owner' && actor.role !== 'admin') {
    throw new ChatError('Only an admin can remove the group owner', 403);
  }

  const activeCount = await ChatMember.count({ where: { groupId, leftAt: null } });
  if (activeCount - 1 < MIN_GROUP_MEMBERS) {
    throw new ChatError(
      `A group needs at least ${MIN_GROUP_MEMBERS} members. Archive the group instead.`
    );
  }

  const names = await userNames([targetUserId]);
  await endMembership(target, 'removed'); // kick sockets first so they don't see the next line
  await announce(groupId, `${actor.name} removed ${names.get(targetUserId) ?? 'a member'}`);
  return getGroupDetail(actor, groupId);
}

/** Archive = read-only for everyone, history kept. (Groups are never hard-deleted.) */
export async function archiveGroup(actor: Actor, groupId: number) {
  const { group } = await requireManager(actor, groupId);
  if (group.status === 'archived') return getGroupDetail(actor, groupId);

  await announce(groupId, `${actor.name} archived this group. It is now read-only.`);
  await group.update({ status: 'archived' });
  emitToGroup(groupId, 'group:changed', { groupId });
  return getGroupDetail(actor, groupId);
}

export async function renameGroup(actor: Actor, groupId: number, newName: string) {
  const { group } = await requireManager(actor, groupId);
  if (group.status !== 'active') {
    throw new ChatError('Archived groups cannot be renamed', 409);
  }
  const trimmedName = newName.trim();
  if (trimmedName.length < 2 || trimmedName.length > 120) {
    throw new ChatError('Group name must be between 2 and 120 characters');
  }
  const oldName = group.name;
  await group.update({ name: trimmedName });
  // Post system announcement
  await announce(groupId, `${actor.name} renamed the group to "${trimmedName}"`);
  // Notify all members via Socket.IO
  emitToGroup(groupId, 'group:changed', { groupId });
  return getGroupDetail(actor, groupId);
}
/**
 * Permanently deletes a group and its files.
 * Allowed: ONLY Admin, and ONLY once the group is archived.
 */
export async function deleteGroup(actor: Actor, groupId: number) {
  if (actor.role !== 'admin') {
    throw new ChatError('Only administrators can delete groups', 403);
  }
  const group = await getGroupOrThrow(groupId);
  // Groups can be deleted directly without needing to be archived first.
  // 1. Gather all file attachments on disk before DB cascade deletion
  const messages = await ChatMessage.findAll({
    where: { groupId },
    attributes: ['id'],
  });
  const messageIds = messages.map((m) => m.id);
  if (messageIds.length > 0) {
    const attachments = await ChatAttachment.findAll({
      where: { messageId: { [Op.in]: messageIds } },
    });
    const fileIds = attachments.map((a) => a.fileId).filter(Boolean) as string[];
    if (fileIds.length > 0) {
      void bulkDeleteFromImageKit(fileIds);
    }
    await Promise.all(
      attachments
        .filter((att) => !!att.storedName)
        .map((att) =>
          fs.unlink(path.join(UPLOAD_DIR, path.basename(att.storedName!))).catch(() => undefined)
        )
    );
  }
  // 2. Fetch all members to update sockets and notify them
  const members = await ChatMember.findAll({ where: { groupId } });
  // 3. Emit deletion notification to everyone in the group
  emitToGroup(groupId, 'group:changed', { groupId, deleted: true });
  for (const m of members) {
    emitToUser(m.userId, 'group:changed', { groupId, deleted: true });
    removeUserFromGroupRoom(m.userId, groupId);
  }
  // 4. Destroy group row (DB CASCADE handles chat_members, chat_messages, chat_attachments)
  await group.destroy();
  return { id: groupId, deleted: true };
}

// ==========================================================
// Messages
// ==========================================================

export async function getMessages(
  actor: Actor,
  groupId: number,
  opts: { before?: number; limit?: number } = {}
) {
  if (actor.role === 'admin') {
    await getGroupOrThrow(groupId);
  } else {
    await requireMember(groupId, actor.id);
  }

  const take = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const where: Record<string, unknown> = { groupId };
  if (opts.before) where.id = { [Op.lt]: opts.before };

  const rows = await ChatMessage.findAll({ where, order: [['id', 'DESC']], limit: take + 1 });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take).reverse(); // oldest -> newest

  const attachments = await loadAttachments(page.map((m) => m.id));
  return { messages: page.map((m) => serializeMessage(m, attachments.get(m.id))), hasMore };
}

/** Used BEFORE multer runs, so non-members can't even write files to disk. */
export async function assertCanPost(actor: Actor, groupId: number) {
  let group: ChatGroup;
  if (actor.role === 'admin') {
    group = await getGroupOrThrow(groupId);
  } else {
    const res = await requireMember(groupId, actor.id);
    group = res.group;
  }
  if (group.status !== 'active') throw new ChatError('This group is archived and read-only', 409);
  return group;
}

export async function sendMessage(
  actor: Actor,
  groupId: number,
  input: { body?: string; files?: UploadedFile[] }
) {
  // Check whether the sender is allowed to post
  const group = await assertCanPost(actor, groupId);

  const body = (input.body ?? '').trim();
  const files = input.files ?? [];
  if (!body && files.length === 0) throw new ChatError('Message cannot be empty');

  if (body.length > MAX_BODY_LENGTH) {
    throw new ChatError(`Message is too long (max ${MAX_BODY_LENGTH} characters)`);
  }

  // 1. Upload files to ImageKit in parallel
  const uploadedFiles: Array<{
    originalName: string;
    fileId: string;
    url: string;
    mimeType: string;
    size: number;
  }> = [];

  if (files.length > 0) {
    try {
      for (const f of files) {
        const uploaded = await uploadToImageKit(f.buffer, f.originalname, '/chat');
        uploadedFiles.push({
          originalName: f.originalname.slice(0, 255),
          fileId: uploaded.fileId,
          url: uploaded.url,
          mimeType: f.mimetype,
          size: f.size,
        });
      }
    } catch (uploadError) {
      const fileIds = uploadedFiles.map((u) => u.fileId);
      if (fileIds.length > 0) void bulkDeleteFromImageKit(fileIds);
      throw uploadError;
    }
  }

  const { message, attachments } = await sequelize.transaction(async (t) => {
    const message = await ChatMessage.create(
      {
        groupId,
        senderId: actor.id,
        senderName: actor.name,
        type: files.length ? 'file' : 'text',
        body: body || null,
      },
      { transaction: t }
    );
    const attachments = await ChatAttachment.bulkCreate(
      uploadedFiles.map((u) => ({
        messageId: message.id,
        originalName: u.originalName,
        storedName: null,
        fileId: u.fileId,
        url: u.url,
        mimeType: u.mimeType,
        size: u.size,
      })),
      { transaction: t }
    );
    return { message, attachments };
  });

  const payload = serializeMessage(message, attachments);
  emitToGroup(groupId, 'message:new', payload);
   //  Get all active members of this group
  const groupMembers = await ChatMember.findAll({
    where: {
      groupId,
      leftAt: null,
    },
  });

// Get users who are currently viewing this group
const viewingUserIds = await getUsersViewingGroup(groupId);

// Prepare message preview
const messagePreview = body
  ? body.slice(0, 20) + "......"
  : 'Sent an attachment';

// Notify only members who are NOT currently viewing this group
await Promise.all(
  groupMembers
    .filter(
      (member) =>
        member.userId !== actor.id &&
        !viewingUserIds.has(member.userId)
    )
    .map((member) =>
      safeNotify(() =>
        notifyNewMessage(
          member.userId,
          groupId,
          group.name,
          actor.id,
          actor.name,
          message.id,
          messagePreview
        )
      )
    )
);

  // Return the message to the controller
  return payload;

}

/**
 * Soft delete: row stays (so history order/"message deleted" placeholder is kept),
 * but the text is erased and attached files are removed from disk.
 * Allowed: the sender, the group owner, or an admin.
 */
export async function deleteMessage(actor: Actor, groupId: number, messageId: number) {
  let isOwner = false;
  if (actor.role !== 'admin') {
    const { group, member } = await requireMember(groupId, actor.id);
    if (group.status !== 'active') throw new ChatError('This group is archived', 409);
    isOwner = member.role === 'owner';
  } else {
    const group = await getGroupOrThrow(groupId);
    if (group.status !== 'active') throw new ChatError('This group is archived', 409);
  }

  const message = await ChatMessage.findOne({ where: { id: messageId, groupId } });
  if (!message) throw new ChatError('Message not found', 404);
  if (message.type === 'system') throw new ChatError('System messages cannot be deleted');
  if (actor.role !== 'admin' && !isOwner && message.senderId !== actor.id) {
    throw new ChatError('You can only delete your own messages', 403);
  }
  if (message.deletedAt) return { id: message.id, groupId, deleted: true };

  const attachments = await ChatAttachment.findAll({ where: { messageId: message.id } });
  const fileIds = attachments.map((a) => a.fileId).filter(Boolean) as string[];
  if (fileIds.length > 0) {
    void bulkDeleteFromImageKit(fileIds);
  }
  const now = new Date();
  await sequelize.transaction(async (t) => {
    // Keep 'body' intact in the database; only record deletedAt and deletedBy
    await message.update({ deletedAt: now, deletedBy: actor.id }, { transaction: t });
    // Keep 'originalName' intact in the database; only record deletedAt
    await ChatAttachment.update(
      { deletedAt: now },
      { where: { messageId: message.id }, transaction: t }
    );
  });

  emitToGroup(groupId, 'message:deleted', { groupId, messageId: message.id });
  return { id: message.id, groupId, deleted: true };
}

export async function markRead(actor: Actor, groupId: number, messageId: number) {
  const member = await getActiveMembership(groupId, actor.id);
  if (!member) {
    if (actor.role === 'admin') return;
    throw new ChatError('Group not found', 404);
  }
  const msg = await ChatMessage.findOne({ where: { id: messageId, groupId } });
  if (!msg) throw new ChatError('Message not found', 404);
  if (!member.lastReadMessageId || messageId > member.lastReadMessageId) {
    await member.update({ lastReadMessageId: messageId });
  }
}

/** Authorise + locate an attachment. Active group members or admins may download. */
export async function getAttachmentFile(actor: Actor, attachmentId: number) {
  const att = await ChatAttachment.findByPk(attachmentId);
  if (!att || att.deletedAt) throw new ChatError('File not found', 404);

  const msg = await ChatMessage.findByPk(att.messageId);
  if (!msg || msg.deletedAt) throw new ChatError('File not found', 404);

  if (actor.role === 'admin') {
    await getGroupOrThrow(msg.groupId);
  } else {
    await requireMember(msg.groupId, actor.id);
  }

  return {
    filePath: att.storedName ? path.join(UPLOAD_DIR, path.basename(att.storedName)) : null,
    url: att.url,
    mimeType: att.mimeType,
    originalName: att.originalName ?? 'file',
  };
}

// ==========================================================
// Hooks for the rest of your app (tasks / users)
// ==========================================================

/** Call when users are ASSIGNED to a task: they join that task's chat group(s). */
export async function addUsersToTaskGroups(taskId: number, userIds: number[]) {
  if (!userIds.length) return;
  const groups = await ChatGroup.findAll({ where: { taskId, status: 'active' } });
  const names = await userNames(userIds);

  for (const g of groups) {
    for (const userId of userIds) {
      if (await upsertMember(g.id, userId)) {
        emitToGroup(g.id, 'group:changed', { groupId: g.id });
        await announce(g.id, `${names.get(userId) ?? 'A user'} joined (assigned to the task)`);
      }
    }
  }
}

/** Call when a user is UNASSIGNED from a task: they lose access to that task's chat. */
export async function removeUserFromTaskGroups(taskId: number, userId: number) {
  const groups = await ChatGroup.findAll({ where: { taskId } });
  const names = await userNames([userId]);

  for (const g of groups) {
    const member = await getActiveMembership(g.id, userId);
    if (!member || member.role === 'owner') continue; // never auto-remove the owner
    await endMembership(member, 'task_unassigned');
    if (g.status === 'active') {
      await announce(g.id, `${names.get(userId) ?? 'A member'} was removed (unassigned from the task)`);
    }
  }
}

/** Call when a task is DELETED: its chat becomes read-only history. */
export async function archiveTaskGroups(taskId: number) {
  const groups = await ChatGroup.findAll({ where: { taskId, status: 'active' } });
  for (const g of groups) {
    await announce(g.id, 'The linked task was deleted. This group is now read-only.');
    await g.update({ status: 'archived' });
    emitToGroup(g.id, 'group:changed', { groupId: g.id });
  }
}

/** Call when a user account is DELETED. Their old messages stay (name snapshot). */
export async function handleUserDeleted(userId: number) {
  const memberships = await ChatMember.findAll({ where: { userId, leftAt: null } });
  for (const m of memberships) await endMembership(m, 'user_deleted');
  disconnectUser(userId);
}

/** Call when a user is DEACTIVATED. Memberships are kept so re-activation restores access. */
export function handleUserDeactivated(userId: number) {
  disconnectUser(userId);
}