import { config as loadDotenv } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import {
  EnvironmentSecretResolver,
  assertLocalBootstrap,
  parseConfig,
  s3CredentialProvider,
} from '@vision/shared';
import { backupManifestSchema, type BackupManifest } from './backup-contract.js';

const execFile = promisify(execFileCallback);
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COMPOSE_FILE = join(REPO_ROOT, 'infra/compose.yaml');
const ENV_FILE = join(REPO_ROOT, '.env');

loadDotenv({ path: ENV_FILE, quiet: true });
const RECOVERY_DOCS = [
  'docs/spec-artifacts/security-operations/backup-policy.json',
  'docs/spec-artifacts/security-operations/runbooks/RESTORE.md',
  'docs/spec-artifacts/security-operations/runbooks/SECRET_COMPROMISE.md',
  '.env.example',
] as const;

type BackedObject = BackupManifest['objects'][number];

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--'))
    throw new Error(`MISSING_ARGUMENT_${name.slice(2).toUpperCase()}`);
  return value;
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

async function execText(command: string, args: string[]) {
  const result = await execFile(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function assertRegularRepositoryFile(relativePath: string) {
  const lexical = join(REPO_ROOT, relativePath);
  const [repositoryRoot, realFile, info] = await Promise.all([
    realpath(REPO_ROOT),
    realpath(lexical),
    lstat(lexical),
  ]);

  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('BACKUP_RECOVERY_DOC_NOT_REGULAR');
  }

  if (realFile !== repositoryRoot && !realFile.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error('BACKUP_RECOVERY_DOC_ESCAPE');
  }

  return realFile;
}

async function spawnStdoutToFile(command: string, args: string[], destination: string) {
  const output = await open(destination, 'wx', 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', output.fd, 'pipe'] });
      child.stderr?.resume();
      child.on('error', () => reject(new Error('BACKUP_SUBPROCESS_FAILED')));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('BACKUP_SUBPROCESS_FAILED'));
      });
    });
  } finally {
    await output.close();
  }
}

function bodyIterable(output: GetObjectCommandOutput): AsyncIterable<Uint8Array> {
  const body = output.Body;
  if (!body || !(Symbol.asyncIterator in body)) throw new Error('BACKUP_OBJECT_UNREADABLE');
  return body as AsyncIterable<Uint8Array>;
}

async function backupObject(
  client: S3Client,
  bucket: string,
  key: string,
  objectsDirectory: string,
): Promise<BackedObject> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const temporary = join(objectsDirectory, `.part-${randomUUID()}`);
  const file = await open(temporary, 'wx', 0o600);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  try {
    for await (const chunk of bodyIterable(response)) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      sizeBytes += bytes.length;
      await file.write(bytes);
    }
  } finally {
    await file.close();
    const body = response.Body;
    if (body && 'destroy' in body && typeof body.destroy === 'function') body.destroy();
  }
  if (response.ContentLength !== undefined && response.ContentLength !== sizeBytes) {
    await rm(temporary, { force: true });
    throw new Error('BACKUP_OBJECT_SIZE_MISMATCH');
  }
  const digest = hash.digest('hex');
  const fileName = `${digest}.bin`;
  const destination = join(objectsDirectory, fileName);
  try {
    await rename(temporary, destination);
  } catch (error) {
    const existing = await stat(destination).catch(() => null);
    if (!existing || existing.size !== sizeBytes) throw error;
    await rm(temporary, { force: true });
  }
  return {
    key,
    file: `objects/${fileName}`,
    sha256: digest,
    sizeBytes,
    contentType: response.ContentType ?? null,
  };
}

async function backupObjects(client: S3Client, bucket: string, objectsDirectory: string) {
  const objects: BackedObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
      { abortSignal: AbortSignal.timeout(60_000) },
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) throw new Error('BACKUP_OBJECT_KEY_MISSING');
      objects.push(await backupObject(client, bucket, item.Key, objectsDirectory));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !continuationToken) throw new Error('BACKUP_LIST_PAGINATION_INVALID');
  } while (continuationToken);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

export async function createBackup(outputDirectory: string): Promise<BackupManifest> {
  if (!isAbsolute(outputDirectory)) throw new Error('BACKUP_OUTPUT_MUST_BE_ABSOLUTE');
  const config = parseConfig(process.env);
  assertLocalBootstrap(config);
  const outputPath = resolve(outputDirectory);
  const repositoryPath = resolve(REPO_ROOT);
  if (outputPath === repositoryPath || outputPath.startsWith(`${repositoryPath}${sep}`))
    throw new Error('BACKUP_OUTPUT_INSIDE_REPOSITORY');
  const databaseUrl = new URL(config.DATABASE_URL);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (!databaseName) throw new Error('BACKUP_DATABASE_NAME_MISSING');
  const postgresUser = process.env.POSTGRES_USER;
  const postgresDb = process.env.POSTGRES_DB;
  if (!postgresUser || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(postgresUser))
    throw new Error('BACKUP_POSTGRES_USER_INVALID');
  if (!postgresDb || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(postgresDb))
    throw new Error('BACKUP_POSTGRES_DB_INVALID');
  if (postgresDb !== databaseName) throw new Error('BACKUP_DATABASE_IDENTITY_MISMATCH');

  const createdAt = new Date().toISOString();
  await mkdir(outputDirectory, { mode: 0o700 });
  const incomplete = join(outputDirectory, 'INCOMPLETE');
  await writeFile(incomplete, `${createdAt}\n`, { mode: 0o600 });
  const objectsDirectory = join(outputDirectory, 'objects');
  const docsDirectory = join(outputDirectory, 'recovery-docs');
  await mkdir(objectsDirectory, { mode: 0o700 });
  await mkdir(docsDirectory, { mode: 0o700 });

  const secrets = new EnvironmentSecretResolver(process.env, [
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]);
  const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    maxAttempts: 2,
    credentials: s3CredentialProvider(secrets),
  });

  try {
    const postgresFile = join(outputDirectory, 'postgres.dump');
    await spawnStdoutToFile(
      'docker',
      [
        'compose',
        '--env-file',
        ENV_FILE,
        '-f',
        COMPOSE_FILE,
        'exec',
        '-T',
        'postgres',
        'pg_dump',
        '-Fc',
        '--no-owner',
        '--no-acl',
        '-U',
        postgresUser,
        '-d',
        postgresDb,
      ],
      postgresFile,
    );
    const postgres = await sha256File(postgresFile);

    const repositoryFile = join(outputDirectory, 'repository.tar.gz');
    await execFile('git', ['archive', '--format=tar.gz', `--output=${repositoryFile}`, 'HEAD'], {
      cwd: REPO_ROOT,
    });
    await chmod(repositoryFile, 0o600);
    const repository = await sha256File(repositoryFile);
    const gitHead = await execText('git', ['rev-parse', 'HEAD']);
    if (!/^[a-f0-9]{40}$/.test(gitHead)) throw new Error('BACKUP_GIT_HEAD_INVALID');
    const worktreeStatus = await execText('git', ['status', '--porcelain']);

    const recoveryDocs: BackupManifest['recoveryDocs'] = [];
    for (const [index, sourcePath] of RECOVERY_DOCS.entries()) {
      const source = await assertRegularRepositoryFile(sourcePath);
      const file = `recovery-docs/${String(index + 1).padStart(2, '0')}-${sourcePath
        .split('/')
        .at(-1)!}`;
      const destination = join(outputDirectory, file);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(source, destination);
      await chmod(destination, 0o600);
      const metadata = await sha256File(destination);
      recoveryDocs.push({ sourcePath, file, ...metadata });
    }

    const objects = await backupObjects(s3, config.S3_BUCKET, objectsDirectory);
    const completedAt = new Date().toISOString();
    const manifest = backupManifestSchema.parse({
      version: 'v1',
      createdAt,
      completedAt,
      source: {
        environment: config.VCE_ENV,
        databaseName,
        bucket: config.S3_BUCKET,
        gitHead,
        repositoryWorktreeClean: worktreeStatus.length === 0,
      },
      postgres: { file: 'postgres.dump', format: 'pg_dump_custom_v1', ...postgres },
      repository: {
        file: 'repository.tar.gz',
        format: 'git_archive_tar_gz_v1',
        ...repository,
      },
      recoveryDocs,
      objects,
      transport: {
        offHostVerified: false,
        note: 'Portable backup created; off-host copy must be verified separately.',
      },
    });
    await writeFile(
      join(outputDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    await rm(incomplete, { force: true });
    return manifest;
  } finally {
    s3.destroy();
  }
}

async function main() {
  const output = requiredArgument('--output');
  const manifest = await createBackup(output);
  console.log(
    JSON.stringify({
      result: 'PASS',
      manifestVersion: manifest.version,
      objectCount: manifest.objects.length,
      offHostVerified: manifest.transport.offHostVerified,
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const code =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UNKNOWN';
    console.error(`BACKUP_FAILED:${code}`);
    process.exitCode = 1;
  });
}
