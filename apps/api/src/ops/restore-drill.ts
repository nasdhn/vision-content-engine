import { config as loadDotenv } from 'dotenv';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import {
  EnvironmentSecretResolver,
  assertLocalBootstrap,
  parseConfig,
  s3CredentialProvider,
} from '@vision/shared';
import {
  backupManifestSchema,
  recoveryTargetEvaluation,
  resolveBackupFile,
  restoreDrillReportSchema,
  type BackupManifest,
  type RestoreDrillReport,
} from './backup-contract.js';

const execFile = promisify(execFileCallback);
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COMPOSE_FILE = join(REPO_ROOT, 'infra/compose.yaml');
const ENV_FILE = join(REPO_ROOT, '.env');

loadDotenv({ path: ENV_FILE, quiet: true });

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--'))
    throw new Error(`MISSING_ARGUMENT_${name.slice(2).toUpperCase()}`);
  return value;
}

async function execText(command: string, args: string[]) {
  const result = await execFile(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function spawnFileToStdin(command: string, args: string[], source: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['pipe', 'ignore', 'pipe'] });
    const input = createReadStream(source);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      input.destroy();
      child.kill('SIGKILL');
      reject(new Error('RESTORE_SUBPROCESS_FAILED'));
    };
    child.on('error', fail);
    child.stderr.resume();
    child.stdin.on('error', fail);
    input.on('error', fail);
    input.pipe(child.stdin);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error('RESTORE_SUBPROCESS_FAILED'));
    });
  });
}

async function sha256File(path: string) {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    sizeBytes += bytes.length;
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

function bodyIterable(output: GetObjectCommandOutput): AsyncIterable<Uint8Array> {
  const body = output.Body;
  if (!body || !(Symbol.asyncIterator in body)) throw new Error('RESTORE_OBJECT_UNREADABLE');
  return body as AsyncIterable<Uint8Array>;
}

async function sha256Object(client: S3Client, bucket: string, key: string) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const hash = createHash('sha256');
  let sizeBytes = 0;
  try {
    for await (const chunk of bodyIterable(response)) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      sizeBytes += bytes.length;
    }
  } finally {
    const body = response.Body;
    if (body && 'destroy' in body && typeof body.destroy === 'function') body.destroy();
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

async function assertBackupRegularFile(root: string, relative: string) {
  const lexical = resolveBackupFile(root, relative);
  const [realRoot, realFile, info] = await Promise.all([
    realpath(root),
    realpath(lexical),
    lstat(lexical),
  ]);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('BACKUP_FILE_NOT_REGULAR');
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`))
    throw new Error('BACKUP_REALPATH_ESCAPE');
  return realFile;
}

async function verifyBackupFiles(root: string, manifest: BackupManifest) {
  const entries = [
    manifest.postgres,
    manifest.repository,
    ...manifest.recoveryDocs,
    ...manifest.objects,
  ];
  for (const entry of entries) {
    const path = await assertBackupRegularFile(root, entry.file);
    const actual = await sha256File(path);
    if (actual.sha256 !== entry.sha256 || actual.sizeBytes !== entry.sizeBytes) {
      throw new Error('BACKUP_FILE_INTEGRITY_FAILED');
    }
  }
}

async function waitForPostgres(container: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execText('docker', [
        'exec',
        container,
        'pg_isready',
        '-U',
        'vce_restore',
        '-d',
        'vce_restore',
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('RESTORE_POSTGRES_NOT_READY');
}

async function psql(container: string, sql: string) {
  return execText('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'vce_restore',
    '-d',
    'vce_restore',
    '-At',
    '-c',
    sql,
  ]);
}

async function expectedMigrationNames() {
  const root = join(REPO_ROOT, 'prisma/migrations');
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (entries.length === 0) throw new Error('RESTORE_EXPECTED_MIGRATION_MISSING');
  return entries;
}

function parseAssetRows(text: string) {
  if (!text) return [];
  return text.split('\n').map((line) => {
    const [id, bucket, key, checksumSha256, sizeBytes] = line.split('\t');
    if (!id || !bucket || !key) throw new Error('RESTORE_ASSET_SAMPLE_INVALID');
    return {
      id,
      bucket,
      key,
      checksumSha256: checksumSha256 || null,
      sizeBytes: sizeBytes || null,
    };
  });
}

async function verifyAssetSamples(
  container: string,
  manifest: BackupManifest,
  restoredByKey: ReadonlyMap<string, { sha256: string; sizeBytes: number }>,
) {
  const otherBucketCount = Number(
    await psql(
      container,
      `SELECT count(*) FROM "Asset" WHERE status = 'READY' AND "storageProvider" = 'S3' AND "deletedAt" IS NULL AND bucket <> '${manifest.source.bucket}';`,
    ),
  );
  if (!Number.isInteger(otherBucketCount) || otherBucketCount < 0)
    throw new Error('RESTORE_ASSET_COUNT_INVALID');
  if (otherBucketCount > 0) throw new Error('READY_ASSET_OUTSIDE_BACKUP_BUCKET');

  const columns = `a.id::text || E'\\t' || a.bucket || E'\\t' || a."objectKey" || E'\\t' || COALESCE(a."checksumSha256", '') || E'\\t' || COALESCE(a."sizeBytes"::text, '')`;
  const approved = parseAssetRows(
    await psql(
      container,
      `SELECT ${columns} FROM "Render" r JOIN "Asset" a ON a.id = r."approvedAssetId" WHERE r."approvedAssetId" IS NOT NULL AND a.status = 'READY' AND a."deletedAt" IS NULL ORDER BY r."updatedAt" DESC LIMIT 20;`,
    ),
  ).filter((asset) => asset.bucket === manifest.source.bucket);
  const ready = parseAssetRows(
    await psql(
      container,
      `SELECT ${columns} FROM "Asset" a WHERE a.status = 'READY' AND a."storageProvider" = 'S3' AND a."deletedAt" IS NULL ORDER BY a."createdAt" DESC LIMIT 20;`,
    ),
  ).filter((asset) => asset.bucket === manifest.source.bucket);

  const verify = (asset: (typeof ready)[number]) => {
    const restored = restoredByKey.get(asset.key);
    if (!restored) throw new Error('READY_ASSET_MISSING_FROM_BACKUP');
    if (asset.checksumSha256 && asset.checksumSha256 !== restored.sha256)
      throw new Error('READY_ASSET_CHECKSUM_MISMATCH');
    if (asset.sizeBytes && BigInt(asset.sizeBytes) !== BigInt(restored.sizeBytes))
      throw new Error('READY_ASSET_SIZE_MISMATCH');
  };
  approved.forEach(verify);
  ready.forEach(verify);
  return {
    approvedAssetReferenceSamples: approved.length,
    readyAssetReferenceSamples: ready.length,
  };
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'RESTORE_DRILL_FAILED';
}

export async function runRestoreDrill(
  backupDirectory: string,
  reportPath: string,
): Promise<RestoreDrillReport> {
  if (!isAbsolute(backupDirectory) || !isAbsolute(reportPath))
    throw new Error('RESTORE_PATH_MUST_BE_ABSOLUTE');
  const reportOutput = resolve(reportPath);
  const repositoryPath = resolve(REPO_ROOT);
  if (reportOutput === repositoryPath || reportOutput.startsWith(`${repositoryPath}${sep}`))
    throw new Error('RESTORE_REPORT_INSIDE_REPOSITORY');
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const emptyPostgres: RestoreDrillReport['postgres'] = {
    restored: false,
    tableCount: 0,
    appliedMigrationCount: 0,
    latestAppliedMigration: null,
    lineageCounts: {},
  };
  const emptyStorage: RestoreDrillReport['storage'] = {
    restoredObjectCount: 0,
    verifiedObjectCount: 0,
    readyAssetReferenceSamples: 0,
    approvedAssetReferenceSamples: 0,
    syntheticCanaryUsed: false,
  };
  let backupAgeMs = 0;
  let postgres = emptyPostgres;
  let storage = emptyStorage;
  let container: string | undefined;
  let drillBucket: string | undefined;
  const restoredKeys: string[] = [];
  let s3: S3Client | undefined;
  try {
    const config = parseConfig(process.env);
    assertLocalBootstrap(config);
    if (
      await lstat(join(backupDirectory, 'INCOMPLETE')).then(
        () => true,
        () => false,
      )
    )
      throw new Error('BACKUP_MARKED_INCOMPLETE');
    const manifestPath = await assertBackupRegularFile(backupDirectory, 'manifest.json');
    const manifest = backupManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    const createdMs = Date.parse(manifest.createdAt);
    if (!Number.isFinite(createdMs) || createdMs > started)
      throw new Error('INVALID_BACKUP_TIMESTAMP');
    backupAgeMs = started - createdMs;
    await verifyBackupFiles(backupDirectory, manifest);

    const canonicalContainer = await execText('docker', [
      'compose',
      '--env-file',
      ENV_FILE,
      '-f',
      COMPOSE_FILE,
      'ps',
      '-q',
      'postgres',
    ]);
    if (!/^[a-f0-9]{12,64}$/.test(canonicalContainer))
      throw new Error('RESTORE_SOURCE_POSTGRES_CONTAINER_MISSING');
    const imageId = await execText('docker', [
      'inspect',
      '--format',
      '{{.Image}}',
      canonicalContainer,
    ]);
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('RESTORE_POSTGRES_IMAGE_INVALID');

    container = `vce-restore-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const restorePassword = randomBytes(32).toString('hex');
    await execText('docker', [
      'run',
      '-d',
      '--rm',
      '--network',
      'none',
      '--name',
      container,
      '-e',
      'POSTGRES_USER=vce_restore',
      '-e',
      `POSTGRES_PASSWORD=${restorePassword}`,
      '-e',
      'POSTGRES_DB=vce_restore',
      imageId,
    ]);
    await waitForPostgres(container);
    await spawnFileToStdin(
      'docker',
      [
        'exec',
        '-i',
        container,
        'pg_restore',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
        '-U',
        'vce_restore',
        '-d',
        'vce_restore',
      ],
      await assertBackupRegularFile(backupDirectory, manifest.postgres.file),
    );

    const tableCount = Number(
      await psql(
        container,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';",
      ),
    );
    const appliedMigrationNames = (
      await psql(
        container,
        'SELECT DISTINCT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;',
      )
    )
      .split('\n')
      .filter(Boolean);

    const appliedMigrationCount = appliedMigrationNames.length;
    const latestAppliedMigration = appliedMigrationNames.at(-1) ?? null;

    if (!Number.isInteger(tableCount) || tableCount <= 0) throw new Error('RESTORE_SCHEMA_EMPTY');
    if (appliedMigrationCount <= 0) throw new Error('RESTORE_MIGRATIONS_MISSING');

    const expectedMigrations = await expectedMigrationNames();
    const migrationSetMatches =
      appliedMigrationNames.length === expectedMigrations.length &&
      appliedMigrationNames.every((migration, index) => migration === expectedMigrations[index]);

    if (!migrationSetMatches) throw new Error('RESTORE_SCHEMA_VERSION_MISMATCH');

    const lineageCounts = JSON.parse(
      await psql(
        container,
        `SELECT json_build_object(
          'Asset', (SELECT count(*) FROM "Asset"),
          'Render', (SELECT count(*) FROM "Render"),
          'Publication', (SELECT count(*) FROM "Publication"),
          'JobAttempt', (SELECT count(*) FROM "JobAttempt"),
          'OutboxEvent', (SELECT count(*) FROM "OutboxEvent"),
          'ModelInvocation', (SELECT count(*) FROM "ModelInvocation")
        )::text;`,
      ),
    ) as Record<string, number>;
    postgres = {
      restored: true,
      tableCount,
      appliedMigrationCount,
      latestAppliedMigration,
      lineageCounts,
    };

    const secrets = new EnvironmentSecretResolver(process.env, [
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ]);
    s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      maxAttempts: 2,
      credentials: s3CredentialProvider(secrets),
    });
    drillBucket = `vce-restore-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    await s3.send(new CreateBucketCommand({ Bucket: drillBucket }));
    const restoredByKey = new Map<string, { sha256: string; sizeBytes: number }>();
    for (const object of manifest.objects) {
      const source = await assertBackupRegularFile(backupDirectory, object.file);
      const body = createReadStream(source);
      restoredKeys.push(object.key);
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: drillBucket,
            Key: object.key,
            Body: body,
            ContentLength: object.sizeBytes,
            ...(object.contentType ? { ContentType: object.contentType } : {}),
            IfNoneMatch: '*',
          }),
          { abortSignal: AbortSignal.timeout(10 * 60 * 1000) },
        );
      } finally {
        body.destroy();
      }
      const verified = await sha256Object(s3, drillBucket, object.key);
      if (verified.sha256 !== object.sha256 || verified.sizeBytes !== object.sizeBytes)
        throw new Error('RESTORE_OBJECT_INTEGRITY_FAILED');
      restoredByKey.set(object.key, verified);
    }

    let syntheticCanaryUsed = false;
    if (manifest.objects.length === 0) {
      syntheticCanaryUsed = true;
      const key = `__restore_drill__/${randomUUID()}`;
      const bytes = Buffer.from(manifest.repository.sha256, 'utf8');
      restoredKeys.push(key);
      await s3.send(
        new PutObjectCommand({
          Bucket: drillBucket,
          Key: key,
          Body: bytes,
          ContentLength: bytes.length,
        }),
      );
      const verified = await sha256Object(s3, drillBucket, key);
      const expected = createHash('sha256').update(bytes).digest('hex');
      if (verified.sha256 !== expected || verified.sizeBytes !== bytes.length)
        throw new Error('RESTORE_STORAGE_CANARY_FAILED');
    }

    const samples = await verifyAssetSamples(container, manifest, restoredByKey);
    storage = {
      restoredObjectCount: manifest.objects.length,
      verifiedObjectCount: manifest.objects.length,
      ...samples,
      syntheticCanaryUsed,
    };

    const completed = Date.now();
    const report = restoreDrillReportSchema.parse({
      version: 'v1',
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      backupAgeMs,
      result: 'PASS',
      errorCode: null,
      postgres,
      storage,
      targets: recoveryTargetEvaluation(backupAgeMs, completed - started),
    });
    await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    return report;
  } catch (error) {
    const completed = Date.now();
    const report = restoreDrillReportSchema.parse({
      version: 'v1',
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      backupAgeMs,
      result: 'FAILED',
      errorCode: safeErrorCode(error),
      postgres,
      storage,
      targets: recoveryTargetEvaluation(backupAgeMs, completed - started),
    });
    await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 }).catch(() => undefined);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    }).catch(() => undefined);
    throw error;
  } finally {
    if (s3 && drillBucket) {
      for (const key of restoredKeys) {
        await s3
          .send(new DeleteObjectCommand({ Bucket: drillBucket, Key: key }))
          .catch(() => undefined);
      }
      await s3.send(new DeleteBucketCommand({ Bucket: drillBucket })).catch(() => undefined);
    }
    s3?.destroy();
    if (container) await execFile('docker', ['rm', '-f', container]).catch(() => undefined);
  }
}

async function main() {
  const backup = requiredArgument('--backup');
  const report = requiredArgument('--report');
  const result = await runRestoreDrill(backup, report);
  console.log(
    JSON.stringify({
      result: result.result,
      durationMs: result.durationMs,
      backupAgeMs: result.backupAgeMs,
      restoredObjectCount: result.storage.restoredObjectCount,
      readyAssetReferenceSamples: result.storage.readyAssetReferenceSamples,
      approvedAssetReferenceSamples: result.storage.approvedAssetReferenceSamples,
      offHostVerified: result.targets.offHostVerified,
      productionClaimAllowed: result.targets.productionClaimAllowed,
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`RESTORE_DRILL_FAILED:${safeErrorCode(error)}`);
    process.exitCode = 1;
  });
}
