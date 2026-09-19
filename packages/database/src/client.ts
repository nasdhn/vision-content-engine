import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabaseClient(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      options: '-c timezone=UTC',
      max: 8,
      connectionTimeoutMillis: 5000,
    }),
    log: [],
  });
}
