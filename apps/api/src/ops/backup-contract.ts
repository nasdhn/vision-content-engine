import { resolve, sep } from 'node:path';
import { z } from 'zod';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const isoDate = z.string().datetime({ offset: true });
const relativeBackupPath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('\\'))
  .refine(
    (value) =>
      !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'),
  );

const fileEntrySchema = z
  .object({
    file: relativeBackupPath,
    sha256,
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const backupManifestSchema = z
  .object({
    version: z.literal('v1'),
    createdAt: isoDate,
    completedAt: isoDate,
    source: z
      .object({
        environment: z.enum(['LOCAL', 'STAGING_CAPTURE', 'PRODUCTION']),
        databaseName: z.string().min(1),
        bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
        gitHead: z.string().regex(/^[a-f0-9]{40}$/),
        repositoryWorktreeClean: z.boolean(),
      })
      .strict(),
    postgres: fileEntrySchema.extend({ format: z.literal('pg_dump_custom_v1') }).strict(),
    repository: fileEntrySchema.extend({ format: z.literal('git_archive_tar_gz_v1') }).strict(),
    recoveryDocs: z
      .array(
        fileEntrySchema
          .extend({
            sourcePath: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    objects: z.array(
      fileEntrySchema
        .extend({
          key: z.string().min(1),
          contentType: z.string().min(1).nullable(),
        })
        .strict(),
    ),
    transport: z
      .object({
        offHostVerified: z.literal(false),
        note: z.literal('Portable backup created; off-host copy must be verified separately.'),
      })
      .strict(),
  })
  .strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export const restoreDrillReportSchema = z
  .object({
    version: z.literal('v1'),
    startedAt: isoDate,
    completedAt: isoDate,
    durationMs: z.number().int().nonnegative(),
    backupAgeMs: z.number().int().nonnegative(),
    result: z.enum(['PASS', 'FAILED']),
    errorCode: z.string().min(1).nullable(),
    postgres: z
      .object({
        restored: z.boolean(),
        tableCount: z.number().int().nonnegative(),
        appliedMigrationCount: z.number().int().nonnegative(),
        latestAppliedMigration: z.string().nullable(),
        lineageCounts: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    storage: z
      .object({
        restoredObjectCount: z.number().int().nonnegative(),
        verifiedObjectCount: z.number().int().nonnegative(),
        readyAssetReferenceSamples: z.number().int().nonnegative(),
        approvedAssetReferenceSamples: z.number().int().nonnegative(),
        syntheticCanaryUsed: z.boolean(),
      })
      .strict(),
    targets: z
      .object({
        rpoHours: z.literal(24),
        rtoHours: z.literal(4),
        backupAgeWithinTarget: z.boolean(),
        drillDurationWithinTarget: z.boolean(),
        offHostVerified: z.literal(false),
        productionClaimAllowed: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type RestoreDrillReport = z.infer<typeof restoreDrillReportSchema>;

export function resolveBackupFile(root: string, relative: string): string {
  const parsed = relativeBackupPath.parse(relative);
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, parsed);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
    throw new Error('BACKUP_PATH_ESCAPE');
  }
  return candidate;
}

export function recoveryTargetEvaluation(backupAgeMs: number, durationMs: number) {
  if (!Number.isFinite(backupAgeMs) || backupAgeMs < 0) throw new Error('INVALID_BACKUP_AGE');
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('INVALID_DRILL_DURATION');
  return Object.freeze({
    rpoHours: 24 as const,
    rtoHours: 4 as const,
    backupAgeWithinTarget: backupAgeMs <= 24 * 60 * 60 * 1000,
    drillDurationWithinTarget: durationMs <= 4 * 60 * 60 * 1000,
    offHostVerified: false as const,
    productionClaimAllowed: false as const,
  });
}
