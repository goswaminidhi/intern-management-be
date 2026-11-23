import { Request, Response, NextFunction } from "express";
import { ZodType} from "zod";

export const validate =
  (schema: ZodType) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({
        success: false,
        message: errors[0]?.message || 'Validation failed',
        errors,
      });
    }

    // Write cleaned data back (trim, lowercase, coerce)
    const data = result.data as {
      body?: unknown;
      params?: Record<string, string>;
      query?: Record<string, unknown>;
    };
    if (data.body !== undefined) req.body = data.body;
    if (data.params) Object.assign(req.params, data.params);
    if (data.query) req.validatedQuery = data.query;

    next();
  };