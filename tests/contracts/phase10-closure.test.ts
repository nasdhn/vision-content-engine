import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/config.js';
import { configFixture } from '../support/config.js';

const root = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const report = readFileSync('docs/PHASE_10_REPORT.md', 'utf8');
const releaseSmoke = readFileSync('scripts/release-smoke.ts', 'utf8');
const releaseCanary = readFileSync('apps/api/src/release-canary.ts', 'utf8');

const backupPolicy = JSON.parse(
  readFileSync('docs/spec-artifacts/security-operations/backup-policy.json', 'utf8'),
) as {
  postgres: {
    automated: boolean;
    minimumFrequency: string;
    offHost: boolean;
    monitorSuccess: boolean;
    periodicRestoreDrill: boolean;
  };
  targets: {
    initialRpoHours: number;
    initialRtoHours: number;
  };
  redisCanonicalBackupRequired: boolean;
};

const phase10Commits = [
  '90035971f53c71f143ba3a49d9fe9f9c0265627d',
  '715b0d6d4e4ea3e3d2030d13619c2f6c76a65130',
  '8b23b8232b5cf9fb1bab3b076d19e63a3c35c8fe',
  '2fbdc479fcc4b19cb47c8fa4767178770463ad13',
  'fe70939f47ce8c5ddb5d5bfc28feb322e99d853b',
  '16972ed78ad2da0b53f252b0892342e690b64c65',
  '115bd584ffc8b724186a337b1702521c8164b10e',
  'd287aef6fedc0531573a140e3b7536dfd31a9e04',
  'cf8e25f3d7f9cf11a74726076b020cc1057a85bb',
  '0fb8bd3fbf2483d6b94e3bd732f438b949ed2d5f',
  'fa79c5a9175e6d547c58a570bc1de6653b5384d5',
  'dbbadcf144870e25349352024a95205eef2676e7',
  '91c48e6416bd4b37bc884ed2d9fab8bfe868f779',
] as const;

describe('Phase 10 closure contract', () => {
  it('defines the canonical Phase 10 aggregate gate without replacing targeted gates', () => {
    expect(root.scripts['check:phase10']).toBe('pnpm check:phase9 && pnpm check:phase10j');

    expect(root.scripts['test:release-smoke']).toBe('tsx scripts/release-smoke.ts');

    for (const phase of ['a', 'b', 'c', 'd', 'e', 'f', 'h', 'i', 'j']) {
      expect(root.scripts[`check:phase10${phase}`]).toBeTypeOf('string');
    }

    expect(root.scripts['ops:backup']).toBe('pnpm --filter @vision/api exec tsx src/ops/backup.ts');

    expect(root.scripts['ops:restore-drill']).toBe(
      'pnpm --filter @vision/api exec tsx src/ops/restore-drill.ts',
    );
  });

  it('keeps real providers disabled and all emergency work classes paused', () => {
    const config = parseConfig(configFixture);

    expect(config.VCE_REAL_PROVIDERS_ENABLED).toBe('false');
    expect(config.PAUSE_ALL_PUBLISHING).toBe(true);
    expect(config.PAUSE_AI_GENERATION).toBe(true);
    expect(config.PAUSE_CAPTURE).toBe(true);
    expect(config.PAUSE_RENDERING).toBe(true);
    expect(config.PAUSE_ANALYTICS_COLLECTION).toBe(true);

    expect(() =>
      parseConfig({
        ...configFixture,
        VCE_REAL_PROVIDERS_ENABLED: 'true',
      }),
    ).toThrow();
  });

  it('keeps release smoke fail-closed and limited to operational canaries', () => {
    for (const key of [
      'VCE_REAL_PROVIDERS_ENABLED',
      'PAUSE_ALL_PUBLISHING',
      'PAUSE_AI_GENERATION',
      'PAUSE_CAPTURE',
      'PAUSE_RENDERING',
      'PAUSE_ANALYTICS_COLLECTION',
    ]) {
      expect(releaseSmoke).toContain(key);
    }

    expect(releaseSmoke).toContain('checkReleaseCanary');
    expect(releaseCanary).toContain('release-canary/');
    expect(releaseCanary).toContain('RedisHeartbeatStore');
    expect(releaseCanary).toContain('readWorkerHealth');
  });

  it('preserves all canonical incident runbooks', () => {
    for (const name of [
      'DUPLICATE_PUBLICATION.md',
      'PUBLISHING_UNKNOWN.md',
      'QUEUE_STALL.md',
      'RESTORE.md',
      'RUNAWAY_COST.md',
      'SECRET_COMPROMISE.md',
    ]) {
      expect(existsSync(`docs/spec-artifacts/security-operations/runbooks/${name}`)).toBe(true);
    }
  });

  it('preserves the backup policy and does not overclaim recovery targets', () => {
    expect(backupPolicy.postgres).toEqual({
      automated: true,
      minimumFrequency: 'DAILY',
      offHost: true,
      monitorSuccess: true,
      periodicRestoreDrill: true,
    });

    expect(backupPolicy.targets).toMatchObject({
      initialRpoHours: 24,
      initialRtoHours: 4,
    });

    expect(backupPolicy.redisCanonicalBackupRequired).toBe(false);

    expect(report).toContain('Production/off-host evidence');
    expect(report).toContain('RPO: 24 hours');
    expect(report).toContain('RTO: 4 hours');
  });

  it('records the complete Phase 10 implementation lineage', () => {
    expect(report).toContain('1ebcdc1235f0f86b276bbd66512d74716773094c');

    for (const commit of phase10Commits) {
      expect(report).toContain(commit);
    }
  });

  it('records closure without activating Phase 11', () => {
    expect(report).toContain('10K introduces no Prisma schema modification');
    expect(report).toContain('VCE_REAL_PROVIDERS_ENABLED=false');
    expect(report).toContain('Emergency switches are conservative new-work barriers');
    expect(report).toContain('Phase 11 does not start automatically');
    expect(report).toContain('does not enable a provider');
  });
});
