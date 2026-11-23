import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Op } from 'sequelize';
import type { Transaction, WhereAttributeHash, WhereOptions } from 'sequelize';
import User from '../models/user';
import type { UserAttributes, UserRole, UserStatus } from '../models/user';
import Task from '../models/tasks';
import { initAssociations } from '../models/associations';
import { generateToken } from '../middleware/authMiddleware';
import { sendLoginCredentials } from './emailService';

// Ensure self-referential mentor/mentee associations are registered
initAssociations();

// ---------- Errors & Types ----------

export class UserServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'UserServiceError';
  }
}

export interface MentorSummary {
  id: number;
  name: string;
  email: string;
  status: UserStatus;
}

export type PublicUser = Omit<UserAttributes, 'password'> & {
  mentorEmail?: string | null;
  mentor?: MentorSummary | null;
};

export interface CreateUserInput {
  name: string;
  email: string;
  role?: string;
  status?: string;
  password?: string;
  mentor_id?: number | null;
  assigned_to?: string | null;
  assignedMentees?: Array<string | number>;
}

export interface DeleteActor {
  id: number;
  name: string;
  role: UserRole;
  assignedMentees?: number[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  status?: string;
  role?: string;
  mentor_id?: number | null;
  assigned_to?: string | null;
  assignedMentees?: Array<string | number>;
  password?: string;
}

export interface UserFilters {
  id?: string | number;
  email?: string;
  role?: string;
  status?: string;
  name?: string;
  assigned_to?: string;
  mentor_id?: string | number;
  mentorScope?: {
    id: number;
    name: string;
    assignedMentees: number[];
  };
}

export interface AssignMentorResult {
  action: 'assigned' | 'changed' | 'removed' | 'unchanged';
  message: string;
  user: PublicUser;
}

export interface LoginResult {
  message: string;
  token: string;
  user: PublicUser;
  redirectTo: string;
}

const BCRYPT_ROUNDS = 12;
const ALLOWED_ROLES: UserRole[] = ['admin', 'mentee', 'mentor'];
const ALLOWED_STATUSES: UserStatus[] = ['active', 'inactive'];

const MENTOR_PUBLIC_INCLUDE = [
  {
    model: User,
    as: 'mentor',
    attributes: ['id', 'name', 'email', 'role', 'status'],
    required: false,
  },
];

// ---------- Helpers ----------

/** Lowercase the role and map 'intern' -> 'mentee'. Returns null if invalid. */
function normalizeRole(role: string): UserRole | null {
  let normalized = role.trim().toLowerCase();
  if (normalized === 'intern') normalized = 'mentee';
  return ALLOWED_ROLES.includes(normalized as UserRole) ? (normalized as UserRole) : null;
}

function normalizeStatus(status: string): UserStatus | null {
  const normalized = status.trim().toLowerCase();
  return ALLOWED_STATUSES.includes(normalized as UserStatus)
    ? (normalized as UserStatus)
    : null;
}

/** Normalize sentinel unassigned strings ('admin', 'unassigned', '') to null. */
function normalizeAssignedTo(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === 'admin' || lower === 'unassigned') {
    return null;
  }
  return trimmed;
}

/** Resolve unique valid mentee records from numeric IDs or names. */
async function resolveMenteeIds(
  rawMentees: Array<string | number>,
  transaction?: Transaction
): Promise<number[]> {
  if (!Array.isArray(rawMentees) || rawMentees.length === 0) return [];

  const menteeIds = rawMentees.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  const menteeNames = rawMentees.filter(
    (item): item is string =>
      typeof item === 'string' && isNaN(Number(item)) && item.trim().length > 0
  );

  const conditions: WhereOptions<UserAttributes>[] = [];
  if (menteeIds.length > 0) conditions.push({ id: { [Op.in]: menteeIds } });
  if (menteeNames.length > 0) conditions.push({ name: { [Op.in]: menteeNames } });
  if (conditions.length === 0) return [];

  const mentees = await User.findAll({
    where: {
      [Op.and]: [{ [Op.or]: conditions }, { role: 'mentee' }],
    },
    attributes: ['id'],
    transaction,
  });

  return Array.from(new Set(mentees.map((m) => m.id)));
}

/** Parse numeric mentee IDs from potentially mixed JSON array values. */
function normalizeMenteeIdList(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    )
  );
}

/** Remove a mentee ID from every mentor's assignedMentees array (optionally excluding one mentor). */
async function removeMenteeFromMentors(
  menteeId: number,
  transaction?: Transaction,
  excludeMentorId?: number
): Promise<void> {
  const mentors = await User.findAll({
    where: { role: 'mentor' },
    transaction,
  });

  for (const mentor of mentors) {
    if (excludeMentorId !== undefined && mentor.id === excludeMentorId) {
      continue;
    }
    const current = normalizeMenteeIdList(mentor.assignedMentees);
    if (current.includes(menteeId)) {
      await mentor.update(
        { assignedMentees: current.filter((id) => id !== menteeId) },
        { transaction }
      );
    }
  }
}

/** Add a mentee ID to the given mentor's assignedMentees array if not already present. */
async function addMenteeToMentor(
  mentor: User,
  menteeId: number,
  transaction?: Transaction
): Promise<void> {
  await mentor.reload({ transaction });
  const current = normalizeMenteeIdList(mentor.assignedMentees);
  if (!current.includes(menteeId)) {
    await mentor.update({ assignedMentees: [...current, menteeId] }, { transaction });
  }
}

/** Find a mentor by name (case-insensitive). Returns null if not found. */
async function findMentorByName(
  mentorName: string,
  transaction?: Transaction
): Promise<User | null> {
  return User.findOne({
    where: {
      role: 'mentor',
      name: { [Op.iLike]: mentorName.trim() },
    },
    transaction,
  });
}

/** Strip password and normalize associated mentor metadata for API responses. */
function serializePublicUser(
  userInstance: User,
  fallbackMentorByLowerName?: Map<string, MentorSummary>
): PublicUser {
  const raw = userInstance.toJSON() as UserAttributes & {
    password?: string;
    mentor?: (MentorSummary & { role?: UserRole }) | null;
  };
  const { password: _password, mentor: includedMentor, ...baseUser } = raw;

  if (baseUser.role !== 'mentee') {
    return {
      ...baseUser,
      mentor_id: null,
      assigned_to: null,
      mentor: null,
      mentorEmail: null,
    };
  }

  let resolvedMentor: MentorSummary | null = null;
  if (includedMentor && includedMentor.role === 'mentor') {
    resolvedMentor = {
      id: includedMentor.id,
      name: includedMentor.name,
      email: includedMentor.email,
      status: includedMentor.status,
    };
  } else if (fallbackMentorByLowerName && baseUser.assigned_to) {
    const legacyName = normalizeAssignedTo(baseUser.assigned_to);
    if (legacyName) {
      resolvedMentor = fallbackMentorByLowerName.get(legacyName.toLowerCase()) ?? null;
    }
  }

  return {
    ...baseUser,
    mentor_id: resolvedMentor ? resolvedMentor.id : null,
    assigned_to: resolvedMentor ? resolvedMentor.name : null,
    mentorEmail: resolvedMentor ? resolvedMentor.email : null,
    mentor: resolvedMentor,
  };
}

/** Resolve and validate a target mentor by mentor_id (preferred) or legacy assigned_to name. */
async function resolveMentorTarget(
  input: { mentor_id?: number | null; assigned_to?: string | null },
  transaction: Transaction,
  allowExistingMentorId?: number | null
): Promise<User | null> {
  if (input.mentor_id !== undefined) {
    if (input.mentor_id === null) {
      return null;
    }

    const mentor = await User.findByPk(input.mentor_id, { transaction });
    if (!mentor) {
      throw new UserServiceError(404, 'Mentor not found');
    }
    if (mentor.role !== 'mentor') {
      throw new UserServiceError(400, 'Selected user is not a mentor');
    }
    if (mentor.status !== 'active' && mentor.id !== allowExistingMentorId) {
      throw new UserServiceError(400, 'Cannot assign an inactive mentor');
    }
    return mentor;
  }

  if (input.assigned_to !== undefined) {
    const requestedMentor = normalizeAssignedTo(input.assigned_to);
    if (!requestedMentor) {
      return null;
    }

    const mentor = await findMentorByName(requestedMentor, transaction);
    if (!mentor) {
      throw new UserServiceError(400, 'Assigned mentor not found');
    }
    if (mentor.status !== 'active' && mentor.id !== allowExistingMentorId) {
      throw new UserServiceError(400, 'Cannot assign an inactive mentor');
    }
    return mentor;
  }

  return null;
}

// ---------- Service ----------

const userService = {
  // Create a new user
  async createUser(
    userData: CreateUserInput
  ): Promise<PublicUser & { message: string }> {
    const { name, email, role, status, password, mentor_id, assigned_to, assignedMentees } =
      userData;

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new UserServiceError(409, 'A user with this email already exists');
    }

    const normalizedRole = normalizeRole(role || 'mentee');
    if (!normalizedRole) {
      throw new UserServiceError(400, 'Invalid role');
    }

    const normalizedStatus = status ? normalizeStatus(status) : 'active';
    if (!normalizedStatus) {
      throw new UserServiceError(400, 'Invalid status');
    }

    const customPassword = password?.trim();
    const initialPassword =
      customPassword && customPassword.length >= 8
        ? customPassword
        : crypto.randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);

    const sequelize = User.sequelize;
    if (!sequelize) {
      throw new Error('Database connection is not initialized');
    }

    const createdUser = await sequelize.transaction(async (transaction) => {
      let resolvedAssignedTo: string | null = null;
      let resolvedMentorId: number | null = null;
      let targetMentor: User | null = null;

      if (normalizedRole === 'mentee') {
        targetMentor = await resolveMentorTarget({ mentor_id, assigned_to }, transaction);
        if (targetMentor) {
          resolvedAssignedTo = targetMentor.name;
          resolvedMentorId = targetMentor.id;
        }
      }

      const resolvedMenteeIds =
        normalizedRole === 'mentor' && Array.isArray(assignedMentees)
          ? await resolveMenteeIds(assignedMentees, transaction)
          : [];

      const user = await User.create(
        {
          name: name.trim(),
          email: normalizedEmail,
          password: hashedPassword,
          role: normalizedRole,
          status: normalizedStatus,
          mentor_id: resolvedMentorId,
          assigned_to: resolvedAssignedTo,
          assignedMentees: resolvedMenteeIds,
          firstLogin: true,
        },
        { transaction }
      );

      if (targetMentor) {
        await addMenteeToMentor(targetMentor, user.id, transaction);
      }

      if (normalizedRole === 'mentor' && resolvedMenteeIds.length > 0) {
        // Remove newly claimed mentees from previous mentors before reassigning
        for (const menteeId of resolvedMenteeIds) {
          await removeMenteeFromMentors(menteeId, transaction, user.id);
        }
        await User.update(
          { mentor_id: user.id, assigned_to: user.name },
          {
            where: { id: { [Op.in]: resolvedMenteeIds }, role: 'mentee' },
            transaction,
          }
        );
        await user.update({ assignedMentees: resolvedMenteeIds }, { transaction });
      }

      const hydrated = await User.findByPk(user.id, {
        attributes: { exclude: ['password'] },
        include: MENTOR_PUBLIC_INCLUDE,
        transaction,
      });

      const finalUser = hydrated ?? user;

      if (!customPassword) {
        try {
          await sendLoginCredentials(finalUser, initialPassword);
        } catch (mailError) {
          console.error('Failed to send login credentials email:', mailError);
          throw new Error(
            'Failed to send login credentials email. User creation was rolled back.'
          );
        }
      }

      return finalUser;
    });

    let emailMessage = 'User created and login credentials emailed successfully';
    if (customPassword) {
      try {
        await sendLoginCredentials(createdUser, initialPassword);
      } catch (mailError) {
        console.error('Failed to send login credentials email:', mailError);
        emailMessage = 'User created successfully (credential email could not be delivered)';
      }
    }

    return {
      ...serializePublicUser(createdUser),
      message: emailMessage,
    };
  },

  // Filter users by ID, email, role, status, name, mentor_id, or assigned_to
  // No query parameters means all users
  async filterUsers(filters: UserFilters = {}): Promise<PublicUser[]> {
    const { id, email, role, status, name, assigned_to, mentor_id, mentorScope } = filters;

    const where: WhereAttributeHash<UserAttributes> = {};

    // Filter by user ID
    if (id !== undefined && id !== '') {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) return [];
      where.id = numericId;
    }

    // Filter by email (case-insensitive)
    if (email) {
      where.email = { [Op.iLike]: email.trim() };
    }

    // Filter by role (normalize lowercase and map 'intern' -> 'mentee')
    if (role) {
      const normalizedRole = normalizeRole(role);
      if (!normalizedRole) {
        return [];
      }
      where.role = normalizedRole;
    }

    // Filter by status (normalize lowercase e.g. "Active" -> "active")
    if (status) {
      const normalizedStatus = normalizeStatus(status);
      if (!normalizedStatus) {
        return [];
      }
      where.status = normalizedStatus;
    }

    // Filter by assigned_to (case-insensitive)
    if (assigned_to) {
      where.assigned_to = { [Op.iLike]: assigned_to.trim() };
    }

    // Filter by mentor_id foreign key
    if (mentor_id !== undefined && mentor_id !== '') {
      const numericMentorId = Number(mentor_id);
      if (!Number.isInteger(numericMentorId) || numericMentorId <= 0) return [];
      where.mentor_id = numericMentorId;
    }

    // Filter by partial, case-insensitive name
    if (name) {
      const escapedName = name.trim().replace(/[\\%_]/g, '\\$&');
      where.name = { [Op.iLike]: `%${escapedName}%` };
    }

    // Scope mentor callers strictly to their assigned mentees
    if (mentorScope) {
      if (where.role && where.role !== 'mentee') {
        return [];
      }
      if (
        assigned_to &&
        assigned_to.trim().toLowerCase() !== mentorScope.name.trim().toLowerCase()
      ) {
        return [];
      }
      if (where.mentor_id !== undefined && where.mentor_id !== mentorScope.id) {
        return [];
      }
      where.role = 'mentee';
      const scopedIds = Array.isArray(mentorScope.assignedMentees)
        ? mentorScope.assignedMentees
        : [];
      const scopeConditions: WhereOptions<UserAttributes>[] = [
        { mentor_id: mentorScope.id },
        { assigned_to: { [Op.iLike]: mentorScope.name.trim() } },
      ];
      if (scopedIds.length > 0) {
        scopeConditions.push({ id: { [Op.in]: scopedIds } });
      }
      (where as Record<symbol, unknown>)[Op.or] = scopeConditions;
      delete where.assigned_to;
      delete where.mentor_id;
    }

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password'] },
      include: MENTOR_PUBLIC_INCLUDE,
      order: [['id', 'ASC']],
    });

    // Build lookup map of existing mentors for any un-migrated legacy assigned_to values
    const existingMentors = await User.findAll({
      where: { role: 'mentor' },
      attributes: ['id', 'name', 'email', 'status'],
    });
    const mentorByLowerName = new Map<string, MentorSummary>();
    for (const m of existingMentors) {
      const key = m.name.toLowerCase().trim();
      if (!mentorByLowerName.has(key)) {
        mentorByLowerName.set(key, {
          id: m.id,
          name: m.name,
          email: m.email,
          status: m.status,
        });
      }
    }

    return users.map((u) => serializePublicUser(u, mentorByLowerName));
  },

  // Get a single user by ID (without the password)
  async getUserById(id: number | string): Promise<PublicUser> {
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] },
      include: MENTOR_PUBLIC_INCLUDE,
    });

    if (!user) {
      throw new UserServiceError(404, 'User not found');
    }

    if (user.role === 'mentee' && !user.mentor && user.assigned_to) {
      const legacyName = normalizeAssignedTo(user.assigned_to);
      if (legacyName) {
        const mentor = await findMentorByName(legacyName);
        if (mentor) {
          const map = new Map<string, MentorSummary>([
            [
              legacyName.toLowerCase(),
              { id: mentor.id, name: mentor.name, email: mentor.email, status: mentor.status },
            ],
          ]);
          return serializePublicUser(user, map);
        }
      }
    }

    return serializePublicUser(user);
  },
  // Update user details
  async updateUser(
    id: number | string,
    updateData: UpdateUserInput
  ): Promise<PublicUser> {
    const user = await User.findByPk(id);

    if (!user) {
      throw new UserServiceError(404, 'User not found');
    }

    const {
      name,
      email,
      status,
      role,
      mentor_id,
      assigned_to,
      assignedMentees,
      password,
    } = updateData;

    const normalizedEmail = email?.trim().toLowerCase();
    if (normalizedEmail && normalizedEmail !== user.email) {
      const existingUser = await User.findOne({
        where: {
          email: normalizedEmail,
          id: { [Op.ne]: user.id },
        },
      });

      if (existingUser) {
        throw new UserServiceError(409, 'A user with this email already exists');
      }
    }

    let normalizedRole: UserRole | undefined;
    if (role !== undefined) {
      const parsedRole = normalizeRole(role);
      if (!parsedRole) throw new UserServiceError(400, 'Invalid role');
      normalizedRole = parsedRole;
    }

    let normalizedStatus: UserStatus | undefined;
    if (status !== undefined) {
      const parsedStatus = normalizeStatus(status);
      if (!parsedStatus) throw new UserServiceError(400, 'Invalid status');
      normalizedStatus = parsedStatus;
    }

    const sequelize = User.sequelize;
    if (!sequelize) {
      throw new Error('Database connection is not initialized');
    }

    const updatedUser = await sequelize.transaction(async (transaction) => {
      const oldName = user.name;
      const oldRole = user.role;
      const effectiveRole = normalizedRole ?? user.role;
      const finalName = name !== undefined ? name.trim() : user.name;

      const updates: Partial<UserAttributes> = {};
      if (name !== undefined) updates.name = finalName;
      if (normalizedEmail !== undefined) updates.email = normalizedEmail;
      if (normalizedStatus !== undefined) updates.status = normalizedStatus;
      if (normalizedRole !== undefined) updates.role = normalizedRole;

      // Password is only updated when explicitly provided and >= 8 chars
      if (typeof password === 'string' && password.trim().length > 0) {
        if (password.trim().length < 8) {
          throw new UserServiceError(400, 'Password must be at least 8 characters');
        }
        updates.password = await bcrypt.hash(password.trim(), BCRYPT_ROUNDS);
      }

      // If a mentor is renamed (and remains a mentor), propagate name to their mentees
      if (oldRole === 'mentor' && effectiveRole === 'mentor' && finalName !== oldName) {
        await User.update(
          { assigned_to: finalName, mentor_id: user.id },
          {
            where: {
              role: 'mentee',
              [Op.or]: [
                { mentor_id: user.id },
                { assigned_to: { [Op.iLike]: oldName.trim() } },
              ],
            },
            transaction,
          }
        );
      }

      // Handle mentor assignedMentees updates
      if (effectiveRole === 'mentor' && assignedMentees !== undefined) {
        const nextMenteeIds = await resolveMenteeIds(assignedMentees, transaction);
        const currentMenteeIds = normalizeMenteeIdList(user.assignedMentees);
        const removedIds = currentMenteeIds.filter((mid) => !nextMenteeIds.includes(mid));

        if (removedIds.length > 0) {
          await User.update(
            { mentor_id: null, assigned_to: null },
            {
              where: {
                id: { [Op.in]: removedIds },
                role: 'mentee',
                [Op.or]: [
                  { mentor_id: user.id },
                  { assigned_to: { [Op.iLike]: oldName.trim() } },
                ],
              },
              transaction,
            }
          );
        }

        for (const mid of nextMenteeIds) {
          await removeMenteeFromMentors(mid, transaction, user.id);
        }

        if (nextMenteeIds.length > 0) {
          await User.update(
            { mentor_id: user.id, assigned_to: finalName },
            {
              where: { id: { [Op.in]: nextMenteeIds }, role: 'mentee' },
              transaction,
            }
          );
        }

        updates.assignedMentees = nextMenteeIds;
      } else if (oldRole === 'mentor' && effectiveRole !== 'mentor') {
        await User.update(
          { mentor_id: null, assigned_to: null },
          {
            where: {
              role: 'mentee',
              [Op.or]: [
                { mentor_id: user.id },
                { assigned_to: { [Op.iLike]: oldName.trim() } },
              ],
            },
            transaction,
          }
        );
        updates.assignedMentees = [];
      }

      // Handle mentee mentor_id / assigned_to updates
      if (effectiveRole === 'mentee' && (mentor_id !== undefined || assigned_to !== undefined)) {
        const targetMentor = await resolveMentorTarget(
          { mentor_id, assigned_to },
          transaction,
          user.mentor_id
        );
        await removeMenteeFromMentors(user.id, transaction, targetMentor?.id);
        if (targetMentor) {
          updates.mentor_id = targetMentor.id;
          updates.assigned_to = targetMentor.name;
          await addMenteeToMentor(targetMentor, user.id, transaction);
        } else {
          updates.mentor_id = null;
          updates.assigned_to = null;
        }
      } else if (oldRole === 'mentee' && effectiveRole !== 'mentee') {
        await removeMenteeFromMentors(user.id, transaction);
        updates.mentor_id = null;
        updates.assigned_to = null;
      }

      await user.update(updates, { transaction });

      const hydrated = await User.findByPk(user.id, {
        attributes: { exclude: ['password'] },
        include: MENTOR_PUBLIC_INCLUDE,
        transaction,
      });

      return hydrated ?? user;
    });

    return serializePublicUser(updatedUser);
  },

  // Assign, change, or remove a mentor for a mentee (Admin only)
  async assignMentorToMentee(
    menteeIdInput: number | string,
    mentorIdInput: number | null
  ): Promise<AssignMentorResult> {
    const sequelize = User.sequelize;
    if (!sequelize) {
      throw new Error('Database connection is not initialized');
    }

    const menteeId = Number(menteeIdInput);
    if (!Number.isInteger(menteeId) || menteeId <= 0) {
      throw new UserServiceError(400, 'Invalid mentee ID');
    }

    if (mentorIdInput !== null && (!Number.isInteger(mentorIdInput) || mentorIdInput <= 0)) {
      throw new UserServiceError(400, 'Invalid mentor ID');
    }

    return sequelize.transaction(async (transaction) => {
      const mentee = await User.findByPk(menteeId, { transaction });
      if (!mentee) {
        throw new UserServiceError(404, 'Mentee not found');
      }

      if (mentee.role !== 'mentee') {
        throw new UserServiceError(400, 'Target user is not a mentee');
      }

      const previousMentorId = mentee.mentor_id ?? null;
      const hadPreviousAssignment =
        previousMentorId !== null || Boolean(normalizeAssignedTo(mentee.assigned_to));

      if (mentorIdInput === null) {
        await removeMenteeFromMentors(mentee.id, transaction);
        await mentee.update(
          { mentor_id: null, assigned_to: null },
          { transaction }
        );

        const hydrated = await User.findByPk(mentee.id, {
          attributes: { exclude: ['password'] },
          include: MENTOR_PUBLIC_INCLUDE,
          transaction,
        });

        return {
          action: hadPreviousAssignment ? 'removed' : 'unchanged',
          message: hadPreviousAssignment
            ? 'Mentor assignment removed successfully'
            : 'Mentee does not have an assigned mentor',
          user: serializePublicUser(hydrated ?? mentee),
        };
      }

      if (mentorIdInput === mentee.id) {
        throw new UserServiceError(400, 'Selected user cannot be assigned as their own mentor');
      }

      const mentor = await resolveMentorTarget({ mentor_id: mentorIdInput }, transaction);
      if (!mentor) {
        throw new UserServiceError(404, 'Mentor not found');
      }

      await removeMenteeFromMentors(mentee.id, transaction, mentor.id);
      await addMenteeToMentor(mentor, mentee.id, transaction);
      await mentee.update(
        {
          mentor_id: mentor.id,
          assigned_to: mentor.name,
        },
        { transaction }
      );

      const hydrated = await User.findByPk(mentee.id, {
        attributes: { exclude: ['password'] },
        include: MENTOR_PUBLIC_INCLUDE,
        transaction,
      });

      const isSameMentor = previousMentorId === mentor.id;
      const action: AssignMentorResult['action'] = isSameMentor
        ? 'unchanged'
        : hadPreviousAssignment
          ? 'changed'
          : 'assigned';

      const message = isSameMentor
        ? `Mentee is already assigned to ${mentor.name}`
        : hadPreviousAssignment
          ? `Mentor changed to ${mentor.name} successfully`
          : `Mentor ${mentor.name} assigned successfully`;

      return {
        action,
        message,
        user: serializePublicUser(hydrated ?? mentee),
      };
    });
  },

  // User login & JWT signing
  async login(email: string, password: string): Promise<LoginResult> {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rawPassword = password;

    // Admin credentials from .env
    const adminEmail = (
      process.env.GMAIL ||
      process.env.ADMIN_EMAIL ||
      process.env.ADMIN_GMAIL ||
      ''
    ).trim().toLowerCase();

    const adminPassword = (
      process.env.password !== undefined
        ? String(process.env.password)
        : process.env.ADMIN_PASSWORD || ''
    ).trim();

    // Check if the provided credentials match the admin credentials in .env
    const isAdminEnvMatch = Boolean(
      adminEmail &&
      adminPassword &&
      normalizedEmail === adminEmail &&
      rawPassword === adminPassword
    );

    let user: User | null = null;

    if (isAdminEnvMatch) {
      // Step: Treat user as admin
      user = await User.findOne({
        where: { email: adminEmail },
        attributes: {
          include: ['password'],
        },
        include: MENTOR_PUBLIC_INCLUDE,
      });

      if (!user) {
        // Automatically create admin user record in DB if not already present
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        user = await User.create({
          name: 'Admin',
          email: adminEmail,
          password: hashedPassword,
          role: 'admin',
          status: 'active',
          firstLogin: false,
          on_Board: true,
        });
      } else {
        // Ensure user is treated as admin and active
        const updates: Partial<{ role: UserRole; status: UserStatus; password: string }> = {};
        if (user.role !== 'admin') {
          updates.role = 'admin';
        }
        if (user.status !== 'active') {
          updates.status = 'active';
        }
        const isDbPasswordMatch = await bcrypt.compare(adminPassword, user.password);
        if (!isDbPasswordMatch) {
          updates.password = await bcrypt.hash(adminPassword, 10);
        }
        if (Object.keys(updates).length > 0) {
          await user.update(updates);
          if (updates.role) user.role = updates.role;
          if (updates.status) user.status = updates.status;
          if (updates.password) user.password = updates.password;
        }
      }
    } else {
      user = await User.findOne({
        where: { email: normalizedEmail },
        attributes: {
          include: ['password'],
        },
        include: MENTOR_PUBLIC_INCLUDE,
      });

      if (!user) {
        throw new Error('Invalid email or password');
      }

      if (user.status === 'inactive') {
        throw new Error('Account is inactive. Please contact administrator.');
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new Error('Invalid email or password');
      }
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      firstLogin: user.firstLogin,
    });

    let fallbackMap: Map<string, MentorSummary> | undefined;
    if (user.role === 'mentee' && !user.mentor && user.assigned_to) {
      const legacyName = normalizeAssignedTo(user.assigned_to);
      if (legacyName) {
        const legacyMentor = await findMentorByName(legacyName);
        if (legacyMentor) {
          fallbackMap = new Map([
            [
              legacyName.toLowerCase(),
              {
                id: legacyMentor.id,
                name: legacyMentor.name,
                email: legacyMentor.email,
                status: legacyMentor.status,
              },
            ],
          ]);
        }
      }
    }

    return {
      message: 'Login successful',
      token,
      user: serializePublicUser(user, fallbackMap),
      redirectTo: user.firstLogin ? '/changePassword' : '/dashboard',
    };
  },

  // Change a user's password
  async changePassword(
    userId: string | number,
    newPassword: string
  ) {
    const user = await User.findByPk(userId, {
      include: MENTOR_PUBLIC_INCLUDE,
      attributes: {
      include: ['password'],
    },
    });

    if (!user) {
      throw new UserServiceError(404, 'User not found');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new UserServiceError(400, 'New password cannot be the same as the old password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await user.update({
      password: hashedPassword,
      firstLogin: false,
      on_Board: true,
    });

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      firstLogin: false,
    });

    let fallbackMap: Map<string, MentorSummary> | undefined;
    if (user.role === 'mentee' && !user.mentor && user.assigned_to) {
      const legacyName = normalizeAssignedTo(user.assigned_to);
      if (legacyName) {
        const legacyMentor = await findMentorByName(legacyName);
        if (legacyMentor) {
          fallbackMap = new Map([
            [
              legacyName.toLowerCase(),
              {
                id: legacyMentor.id,
                name: legacyMentor.name,
                email: legacyMentor.email,
                status: legacyMentor.status,
              },
            ],
          ]);
        }
      }
    }

    return {
      message: 'Password changed successfully',
      token,
      user: serializePublicUser(user, fallbackMap),
    };
  },

  // Delete a user (and cascade-delete tasks assigned to deleted mentees)
  async deleteUser(
    id: number | string,
    actor?: DeleteActor
  ): Promise<{ message: string; deletedTasksCount: number }> {
    const user = await User.findByPk(id);

    if (!user) {
      throw new Error('User not found');
    }

    if (actor && actor.id === user.id) {
      throw new Error('You cannot delete your own account');
    }

    if (actor?.role === 'mentor') {
      throw new Error('FORBIDDEN:Mentors are not allowed to delete mentees. Only administrators can delete users.');
    }

    if (user.role === 'mentee') {
      // Only block if this user somehow assigned tasks to other mentees (tasks.assigned_by is RESTRICT)
      const assignedByOtherCount = await Task.count({
        where: {
          assigned_by: user.id,
          mentee_id: { [Op.ne]: user.id },
        },
        paranoid: false,
      });

      if (assignedByOtherCount > 0) {
        throw new Error(
          'Cannot delete user with existing assigned tasks. Delete or reassign their tasks first, or set their status to inactive.'
        );
      }
    } else {
      // tasks.assigned_by enforces ON DELETE RESTRICT for mentors/admins
      const linkedTasksCount = await Task.count({
        where: {
          [Op.or]: [{ mentee_id: user.id }, { assigned_by: user.id }],
        },
        paranoid: false,
      });

      if (linkedTasksCount > 0) {
        throw new Error(
          'Cannot delete user with existing assigned tasks. Delete or reassign their tasks first, or set their status to inactive.'
        );
      }
    }

    const sequelize = User.sequelize;
    if (!sequelize) {
      throw new Error('Database connection is not initialized');
    }

    let deletedTasksCount = 0;

    await sequelize.transaction(async (transaction) => {
      if (user.role === 'mentor') {
        await User.update(
          { mentor_id: null, assigned_to: null },
          {
            where: {
              role: 'mentee',
              [Op.or]: [
                { mentor_id: user.id },
                { assigned_to: { [Op.iLike]: user.name.trim() } },
              ],
            },
            transaction,
          }
        );
      }

      if (user.role === 'mentee') {
        deletedTasksCount = await Task.destroy({
          where: { mentee_id: user.id },
          force: true,
          transaction,
        });
        await removeMenteeFromMentors(user.id, transaction);
      }

      await user.destroy({ transaction });
    });

    return {
      message: 'User deleted successfully',
      deletedTasksCount,
    };
  },
};

export default userService;