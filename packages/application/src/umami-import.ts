import { UmamiInferencePolicySchema } from '@vision/analytics';
import type { UmamiEventsClient, UmamiImportWindow, UmamiInferencePolicy } from '@vision/analytics';
import { Persistence } from '@vision/database';
import type { PrismaClient } from '@vision/database';

export const DEFAULT_UMAMI_INFERENCE_POLICY: UmamiInferencePolicy = Object.freeze({
  enabled: false,
  maxAgeMinutes: 24 * 60,
});

export class UmamiImportService {
  private readonly persistence: Persistence;
  private readonly policy: UmamiInferencePolicy;

  constructor(
    db: PrismaClient,
    private readonly client: Pick<UmamiEventsClient, 'fetchEvents'>,
    inferencePolicy: UmamiInferencePolicy = DEFAULT_UMAMI_INFERENCE_POLICY,
  ) {
    this.persistence = new Persistence(db);
    this.policy = Object.freeze(UmamiInferencePolicySchema.parse(inferencePolicy));
  }

  async importWindow(window: UmamiImportWindow) {
    const batch = await this.client.fetchEvents(window);
    const summary = {
      fetched: batch.rows.length,
      websiteVisitsImported: 0,
      websiteVisitsExisting: 0,
      marketingObservationsImported: 0,
      marketingObservationsExisting: 0,
      direct: 0,
      inferred: 0,
      unknown: 0,
      providerSchemaVersion: batch.providerSchemaVersion,
      inferencePolicy: this.policy,
    };

    for (const row of batch.rows) {
      const result = await this.persistence.transaction(
        { actorType: 'SYSTEM', actorId: 'umami-import' },
        (unit) => unit.analytics.ingestUmamiEvent({ row, inferencePolicy: this.policy }),
      );

      if (result.evidenceKind === 'WEBSITE_VISIT') {
        if (result.kind === 'IMPORTED') summary.websiteVisitsImported += 1;
        else summary.websiteVisitsExisting += 1;
        if (result.confidenceType === 'DIRECT') summary.direct += 1;
        else if (result.confidenceType === 'INFERRED') summary.inferred += 1;
        else summary.unknown += 1;
      } else if (result.kind === 'IMPORTED') {
        summary.marketingObservationsImported += 1;
      } else {
        summary.marketingObservationsExisting += 1;
      }
    }

    return Object.freeze(summary);
  }
}
