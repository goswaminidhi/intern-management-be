import { z } from "zod";

export const userRoleEnum = z.enum(["admin", "mentee", "mentor"]);
export const userStatusEnum = z.enum(["active", "inactive"]);

const idParam = z.object({
  id: z.string().regex(/^[1-9]\d*$/, "Invalid user ID"),
});

const positiveIntId = z.preprocess(
  (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v),
  z.number().int("Invalid mentor ID").positive("Invalid mentor ID")
);

const nullableMentorIdField = z.preprocess(
  (v) => (v === "" ? null : v),
  positiveIntId.nullable()
);

const emailField = z.email("Invalid email").trim().toLowerCase();

const nameField = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(50, "Name must be at most 50 characters")
  .regex(/^[\p{L}][\p{L}\s'.-]*$/u, "Name can only contain letters and spaces");

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

const assignedMenteesField = z.array(
  z.coerce.number().int().positive("Mentee ID must be a positive integer")
);

// CREATE: optional password (backend generates temp password if omitted), role required
export const createUserSchema = z.object({
  body: z.strictObject({
    name: nameField,
    email: emailField,
    role: userRoleEnum,
    status: userStatusEnum.optional(),
    password: passwordField.optional(),
    mentor_id: nullableMentorIdField.optional(),
    assigned_to: z.string().trim().min(1).nullable().optional(),
    assignedMentees: assignedMenteesField.optional(),
  }),
});

// UPDATE: all optional, at least one required
export const updateUserSchema = z.object({
  params: idParam,
  body: z
    .strictObject({
      name: nameField,
      email: emailField,
      role: userRoleEnum,
      status: userStatusEnum,
      password: passwordField,
      mentor_id: nullableMentorIdField,
      assigned_to: z.string().trim().min(1).nullable(),
      assignedMentees: assignedMenteesField,
    })
    .partial()
    .refine((d) => Object.keys(d).length > 0, {
      message: "At least one field is required",
    }),
});

// ASSIGN / CHANGE / REMOVE MENTOR (Admin only)
export const assignMentorSchema = z.object({
  params: idParam,
  body: z
    .strictObject({
      mentor_id: nullableMentorIdField.optional(),
      mentorId: nullableMentorIdField.optional(),
    })
    .refine((d) => d.mentor_id !== undefined || d.mentorId !== undefined, {
      message: "mentor_id is required (pass a mentor ID or null to unassign)",
    })
    .refine(
      (d) =>
        d.mentor_id === undefined ||
        d.mentorId === undefined ||
        d.mentor_id === d.mentorId,
      {
        message: "Conflicting mentor_id and mentorId values",
      }
    )
    .transform((d) => ({
      mentor_id: d.mentor_id !== undefined ? d.mentor_id : (d.mentorId ?? null),
    })),
});

// GET / DELETE / complete-first-login
export const getUserSchema = z.object({ params: idParam });

// LOGIN
export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    password: z.string().min(1, "Password is required"),
  }),
});

// CHANGE PASSWORD
export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required").optional(),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(72, "New password must be at most 72 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
    /[!@#$%^&*(),.?":{}|<>_\-]/,
    "Password must contain at least one special character"
  )
  }),
});

// GET ALL USERS (query filters)
export const getAllUsersSchema = z.object({
  query: z.object({
    id: z.string().regex(/^[1-9]\d*$/, "Invalid id").optional(),
    email: z.string().trim().optional(),
    role: userRoleEnum.optional(),
    status: userStatusEnum.optional(),
    name: z.string().trim().optional(),
    assigned_to: z.string().trim().optional(),
    mentor_id: z.string().regex(/^[1-9]\d*$/, "Invalid mentor_id").optional(),
  }),
});

// Inferred TS types for controllers
export type CreateUserBody = z.infer<typeof createUserSchema>["body"];
export type UpdateUserBody = z.infer<typeof updateUserSchema>["body"];
export type AssignMentorBody = z.infer<typeof assignMentorSchema>["body"];
export type LoginBody = z.infer<typeof loginSchema>["body"];
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>["body"];