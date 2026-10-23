import { z, type ZodType } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export type ValidationSource = 'body' | 'query' | 'params';

/** Validate one request input location; strict Zod objects reject unknown keys. */
export function validate(schema: ZodType, source: ValidationSource = 'body') {
  if (!['body', 'query', 'params'].includes(source)) throw new TypeError('source must be body, query, or params');
  return (request: Request | any, response: Response, next: NextFunction): any => {
    const input = source === 'body' && request[source] === undefined ? {} : request[source];
    const result = schema.safeParse(input);
    if (!result.success) {
      const fields = [...new Set(result.error.issues.flatMap((issue: any) => {
        if (issue.code === 'unrecognized_keys') return issue.keys;
        const field = issue.path.filter((part: any) => typeof part === 'string' || typeof part === 'number').join('.');
        return field ? [field] : [];
      }))];
      return response.status(400).json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Fix the highlighted fields.', fields } });
    }
    request.validated ??= {};
    request.validated[source] = result.data;
    return next();
  };
}

export { z };
