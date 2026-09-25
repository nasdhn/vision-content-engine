import { z } from 'zod';
export const MIB = 1024 * 1024;
export const CAPACITY_DEFAULTS = Object.freeze({
  minimumFreeBytes: 256 * MIB,
  maxUploadBytes: 512 * MIB,
  maxArtifactBytes: 512 * MIB,
});
const bytes = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const CapacityPolicySchema = z
  .object({ minimumFreeBytes: bytes, maxUploadBytes: bytes, maxArtifactBytes: bytes })
  .strict();
export type CapacityPolicy = Readonly<z.infer<typeof CapacityPolicySchema>>;
export function capacityPolicy(value: unknown = CAPACITY_DEFAULTS): CapacityPolicy {
  const result = CapacityPolicySchema.safeParse(value);
  if (!result.success) throw new Error('INVALID_CAPACITY_POLICY');
  return Object.freeze(result.data);
}
