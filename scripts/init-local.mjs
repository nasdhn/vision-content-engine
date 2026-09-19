import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const secret = () => randomBytes(32).toString('hex');
const databasePassword = secret();
const redisPassword = secret();
const values = {
  POSTGRES_PASSWORD: databasePassword,
  REDIS_PASSWORD: redisPassword,
  DATABASE_URL: `postgresql://vce_local:${databasePassword}@127.0.0.1:55432/vision_content_engine`,
  REDIS_URL: `redis://:${redisPassword}@127.0.0.1:56379/0`,
  S3_ACCESS_KEY_ID: `vce${randomBytes(8).toString('hex')}`,
  S3_SECRET_ACCESS_KEY: secret(),
};
const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = example.replace(/^(\w+)=GENERATED_BY_LOCAL_INIT$/gm, (_, key) => {
  if (!values[key]) throw new Error('Unknown local initialization field');
  return `${key}=${values[key]}`;
});
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env for LOCAL services. No credentials printed.');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log('.env already exists; preserved unchanged.');
  } else {
    // eslint-disable-next-line preserve-caught-error -- Do not expose secret-bearing I/O diagnostics.
    throw new Error('Unable to initialize local environment');
  }
}
