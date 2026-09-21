import type { PrismaClient } from '@vision/database';
import { Persistence } from '@vision/database';
import { invariant } from '@vision/domain';

export const CAPTURE_RECONCILIATION_FAILURE_CODE = 'CAPTURE_RECONCILIATION_REQUIRED';

export class CaptureRecovery {
  private readonly persistence: Persistence;

  constructor(private readonly client: PrismaClient) {
    this.persistence = new Persistence(client);
  }

  async recoverExpired(limit = 100) {
    invariant(
      Number.isSafeInteger(limit) && limit > 0 && limit <= 100,
      'CAPTURE_RECOVERY_LIMIT_INVALID',
    );

    /*
     * Discovery may race with heartbeat/finalization.
     * reconcileExpiredJob() re-checks everything
     * under the JobAttempt lock using DB time.
     */
    const candidates = await this.client.jobAttempt.findMany({
      where: {
        queueName: 'capture',
        jobType: 'CAPTURE',
        status: 'RUNNING',
        leaseExpiresAt: {
          lte: new Date(),
        },
      },
      orderBy: [
        {
          leaseExpiresAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      take: limit,
      select: {
        id: true,
      },
    });

    const recovered = [];

    for (const candidate of candidates) {
      const result = await this.persistence.transaction(
        {
          actorType: 'SYSTEM',
        },
        (unit) => unit.captures.reconcileExpiredJob(candidate.id),
      );

      if (result) {
        recovered.push(result);
      }
    }

    return recovered;
  }
}
