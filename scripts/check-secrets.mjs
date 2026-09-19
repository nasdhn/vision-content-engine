import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
];
const forbiddenFile =
  /(?:^|\/)(?:\.env(?:\..+)?|storageState\.json|storage-state\.json|credentials\.json|secrets\.json)$/;
const failures = [];
for (const file of files) {
  if (forbiddenFile.test(file) && file !== '.env.example') {
    failures.push(file);
    continue;
  }
  const content = await readFile(file);
  if (content.includes(0)) continue;
  if (patterns.some((pattern) => pattern.test(content.toString('utf8')))) failures.push(file);
}
if (failures.length) {
  console.error(`Secret scan failed; inspect these paths locally: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(
    `Secret-pattern scan passed (${files.length} versionable files; ignored local credentials excluded).`,
  );
}
