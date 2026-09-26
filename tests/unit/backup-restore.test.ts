import { describe, expect, it } from 'vitest';
import {
  backupManifestSchema,
  recoveryTargetEvaluation,
  resolveBackupFile,
  restoreDrillReportSchema,
} from '../../apps/api/src/ops/backup-contract.js';

const sha = 'a'.repeat(64);
const now = '2026-09-26T09:00:00.000Z';

function manifest() {
  return {
    version: 'v1',
    createdAt: now,
    completedAt: now,
    source: {
      environment: 'LOCAL',
      databaseName: 'vision_content_engine',
      bucket: 'vce-local-media',
      gitHead: 'b'.repeat(40),
      repositoryWorktreeClean: false,
    },
    postgres: {
      file: 'postgres.dump',
      sha256: sha,
      sizeBytes: 100,
      format: 'pg_dump_custom_v1',
    },
    repository: {
      file: 'repository.tar.gz',
      sha256: sha,
      sizeBytes: 200,
      format: 'git_archive_tar_gz_v1',
    },
    recoveryDocs: [
      {
        sourcePath: 'docs/spec-artifacts/security-operations/runbooks/RESTORE.md',
        file: 'recovery-docs/01-RESTORE.md',
        sha256: sha,
        sizeBytes: 300,
      },
    ],
    objects: [
      {
        key: 'renders/example.mp4',
        file: `objects/${sha}.bin`,
        sha256: sha,
        sizeBytes: 400,
        contentType: 'video/mp4',
      },
    ],
    transport: {
      offHostVerified: false,
      note: 'Portable backup created; off-host copy must be verified separately.',
    },
  };
}

describe('Phase 10H backup/restore contract', () => {
  it('accepts a secret-free portable backup manifest and rejects traversal or invalid buckets', () => {
    expect(backupManifestSchema.parse(manifest()).objects).toHaveLength(1);

    const traversal = manifest();
    traversal.objects[0]!.file = '../outside';
    expect(() => backupManifestSchema.parse(traversal)).toThrow();

    const absolute = manifest();
    absolute.postgres.file = '/tmp/postgres.dump';
    expect(() => backupManifestSchema.parse(absolute)).toThrow();

    const injection = manifest();
    injection.source.bucket = 'bucket\'; DROP TABLE "Asset"; --';
    expect(() => backupManifestSchema.parse(injection)).toThrow();
  });

  it('keeps resolved backup files beneath the selected backup root', () => {
    expect(resolveBackupFile('/tmp/vce-backup', 'objects/a.bin')).toBe(
      '/tmp/vce-backup/objects/a.bin',
    );
    expect(() => resolveBackupFile('/tmp/vce-backup', '../escape')).toThrow();
    expect(() => resolveBackupFile('/tmp/vce-backup', '/absolute')).toThrow();
    expect(() => resolveBackupFile('/tmp/vce-backup', '.')).toThrow();
  });

  it('evaluates recovery targets without claiming off-host production recovery', () => {
    expect(recoveryTargetEvaluation(23 * 60 * 60 * 1000, 3 * 60 * 60 * 1000)).toEqual({
      rpoHours: 24,
      rtoHours: 4,
      backupAgeWithinTarget: true,
      drillDurationWithinTarget: true,
      offHostVerified: false,
      productionClaimAllowed: false,
    });
    expect(recoveryTargetEvaluation(25 * 60 * 60 * 1000, 5 * 60 * 60 * 1000)).toMatchObject({
      backupAgeWithinTarget: false,
      drillDurationWithinTarget: false,
      productionClaimAllowed: false,
    });
  });

  it('requires a restore report to retain explicit non-production recovery claims', () => {
    expect(
      restoreDrillReportSchema.parse({
        version: 'v1',
        startedAt: now,
        completedAt: now,
        durationMs: 1000,
        backupAgeMs: 2000,
        result: 'PASS',
        errorCode: null,
        postgres: {
          restored: true,
          tableCount: 50,
          appliedMigrationCount: 3,
          latestAppliedMigration: '20260921154500_phase5_editing_blockers',
          lineageCounts: { Asset: 1 },
        },
        storage: {
          restoredObjectCount: 1,
          verifiedObjectCount: 1,
          readyAssetReferenceSamples: 1,
          approvedAssetReferenceSamples: 1,
          syntheticCanaryUsed: false,
        },
        targets: recoveryTargetEvaluation(2000, 1000),
      }).result,
    ).toBe('PASS');
  });
});
