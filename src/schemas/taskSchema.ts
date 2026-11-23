import { z } from 'zod';

export const TASK_CATEGORIES = [
  'upskill',
  'research',
  'client-project',
  'inhouse-project',
] as const;

export const TASK_STATUSES = [
  'in-progress',
  'submitted',
  'needs-revision',
  'complete',
  'hold',
  'blocker'
] as const;

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

const taskIdParams = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid task ID'),
});

const httpUrlSchema = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .refine((val) => /^https?:\/\//i.test(val), 'URL must start with http:// or https://');

const optionalUrlSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  httpUrlSchema.nullable().optional()
);

// Estimated hours: whole number, 1-1000.
const estimatedHoursValue = z.coerce
  .number()
  .int('Estimated hours must be a whole number')
  .positive('Estimated hours must be positive')
  .max(1000, 'Estimated hours cannot exceed 1000');

// CREATE: optional. Missing / blank / null => undefined (the controller stores null).
const estimatedHoursOnCreate = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  estimatedHoursValue.optional()
);

// UPDATE: optional. Omitted => unchanged, null or "" => clear the estimate.
const estimatedHoursOnUpdate = z.preprocess(
  (v) => (v === '' ? null : v),
  estimatedHoursValue.nullable().optional()
);

// Description may be empty when the mentor only attaches files.
// "description OR at least one attachment" is enforced in the controller/service,
// because files are not part of the body schema.
const descriptionField = z.string().trim().max(10000, 'Description is too long');

// Fields shared by create and update (no defaults here, so partial updates
// never overwrite existing values with a default).
const taskFields = {
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(255),
  description: descriptionField,
  category: z.enum(TASK_CATEGORIES),
  priority: z.enum(TASK_PRIORITIES),
  start_date: z.coerce.date({ message: 'Valid start_date is required' }),
  due_date: z.coerce.date({ message: 'Valid due_date is required' }),
  mentee_id: z.coerce.number().int().positive('Invalid mentee ID'),
};

const dueAfterStart = {
  message: 'Start date must be less than due date',
  path: ['due_date'],
};

// POST /api/tasks  (multipart/form-data: text fields + "attachments" files)
export const createTaskSchema = z.object({
  body: z
    .object({
      ...taskFields,
      description: descriptionField.default(''),
      category: taskFields.category.default('upskill'),
      priority: taskFields.priority.default('medium'),
      estimated_hours: estimatedHoursOnCreate,
    })
    .refine((t) => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return t.start_date >= todayStart;
    }, {
      message: 'Start date cannot be in the past',
      path: ['start_date'],
    })
    .refine((t) => t.due_date.getTime() >= Date.now() - 60000, {
      message: 'Due date cannot be in the past',
      path: ['due_date'],
    })
    .refine((t) => t.start_date < t.due_date, dueAfterStart),
});

// PATCH /api/tasks/:id (every field optional, at least one required)
export const updateTaskSchema = z.object({
  params: taskIdParams,
  body: z
    .object({
      title: taskFields.title.optional(),
      description: taskFields.description.optional(),
      category: taskFields.category.optional(),
      priority: taskFields.priority.optional(),
      start_date: taskFields.start_date.optional(),
      due_date: taskFields.due_date.optional(),
      mentee_id: taskFields.mentee_id.optional(),
      estimated_hours: estimatedHoursOnUpdate,
      status: z.enum(TASK_STATUSES).optional(),
    })
    .refine((t) => Object.keys(t).length > 0, {
      message: 'Provide at least one field to update',
    })
    .refine((t) => !t.start_date || !t.due_date || t.start_date < t.due_date, dueAfterStart),
});

// PATCH /api/tasks/:id/submit
export const submitTaskSchema = z.object({
  params: taskIdParams,
  body: z.object({
    submission_url: httpUrlSchema,
    demo_url: optionalUrlSchema,
    submission_notes: z.preprocess(
      (v) => (v === '' ? null : v),
      z.string().trim().max(5000).nullable().optional()
    ),
  }),
});

// PATCH /api/tasks/:id/evaluate
export const evaluateTaskSchema = z.object({
  params: taskIdParams,
  body: z.object({
    score: z.coerce
      .number()
      .int('Score must be a whole number')
      .min(0, 'Score must be between 0 and 100')
      .max(100, 'Score must be between 0 and 100')
      .nullable()
      .optional(),
    feedback: z.string().trim().min(1, 'Feedback is required').max(5000),
    status: z.enum(['complete', 'needs-revision']).default('complete'),
  }),
});

// PATCH /api/tasks/:id/status (Admin, owning Mentor, or assigned Mentee)
export const updateTaskStatusSchema = z.object({
  params: taskIdParams,
  body: z.object({
    status: z.enum(TASK_STATUSES),
  }),
});

// GET/DELETE /api/tasks/:id
export const taskIdParamSchema = z.object({
  params: taskIdParams,
});

// GET /api/tasks?status=...&page=...
export const listTasksQuerySchema = z.object({
  query: z.object({
    status: z.enum(TASK_STATUSES).optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    mentee_id: z.coerce.number().int().positive().optional(),
    assigned_by: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>['body'];
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>['body'];
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>['body'];
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>['body'];
export type EvaluateTaskInput = z.infer<typeof evaluateTaskSchema>['body'];
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>['query'];
