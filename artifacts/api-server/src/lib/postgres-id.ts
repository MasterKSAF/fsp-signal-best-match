import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

/** PostgreSQL serial/integer IDs are positive signed 32-bit values. This policy
 * is for those columns only; UUID/bigint contracts require their own parsers. */
export const POSTGRES_INT_ID_MAX = 2_147_483_647;
export const postgresIntIdSchema = z.number().int().min(1).max(POSTGRES_INT_ID_MAX);
export const postgresIntIdTextSchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(postgresIntIdSchema);
export const postgresIntIdInputSchema = z.union([postgresIntIdSchema, postgresIntIdTextSchema]);

export function parsePostgresIntId(value: unknown): number | null {
  const parsed = postgresIntIdInputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Guard integer :id parameters before any handler binds them into SQL. The
 * handler still owns authentication, pool isolation and resource existence. */
export function postgresIntIdParam(_req: Request, res: Response, next: NextFunction, value: string): void {
  if (!postgresIntIdTextSchema.safeParse(value).success) {
    res.status(400).json({ error: 'Некорректный идентификатор.' });
    return;
  }
  next();
}
