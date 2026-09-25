import { z } from 'zod';

/** Existing PostgreSQL numeric(18,8) monetary domain, not abstract cost units. */
export const CostAmountSchema = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/);
export const RUNTIME_INTEGER_MAX = 2_147_483_647;
export const RuntimeBudgetSchema = z
  .object({
    key: z.string().min(1).max(160),
    from: z.string().datetime(),
    to: z.string().datetime(),
    limit: CostAmountSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), {
    message: 'Budget window must be ordered',
  });
