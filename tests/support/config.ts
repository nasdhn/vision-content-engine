/** Deliberately invalid credentials; tests never connect to external services. */
export const configFixture = {
  DATABASE_URL: 'postgresql://127.0.0.1:55432/fixture',
  REDIS_URL: 'redis://127.0.0.1:56379',
  S3_ENDPOINT: 'http://127.0.0.1:58333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'fixture-media',
  S3_ACCESS_KEY_ID: 'synthetic-test-identity',
  S3_SECRET_ACCESS_KEY: 'synthetic-test-value',
};
