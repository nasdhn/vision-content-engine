import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CaptureRequestSpecSchema, RecordingRequestSpecSchema } from '@vision/contracts';
import { assertHuman, assertTransition, invariant } from '@vision/domain';
import { changed, databaseTime, lock } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';
import type { Prisma } from './generated/prisma/client.js';

const specs = z.array(RecordingRequestSpecSchema);
const captureSpecs = z.array(CaptureRequestSpecSchema);

const persistedCaptureBrowserConfig = z
  .object({
    specVersionId: z.string().uuid(),
  })
  .passthrough();
const validAsset = { status: 'READY' as const, deletedAt: null };
const assetMetadata = z
  .object({
    kind: z.enum(['AUDIO', 'VIDEO']),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.string().regex(/^(audio|video)\/[a-z0-9.+-]+$/),
    sizeBytes: z.bigint().positive(),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.number().positive().nullable(),
    audioChannels: z.number().int().positive().nullable(),
    sampleRate: z.number().int().positive().nullable(),
  })
  .strict();
export type RecordingAssetMetadata = z.infer<typeof assetMetadata>;

/** All request/selection writers serialize on the CreativePlan root, then request.
 * Immutable versions and historical render inputs are never updated here. */
export class Recordings {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}

  private async version(id: string, writable = true) {
    const v = await this.tx.creativePlanVersion.findUniqueOrThrow({ where: { id } });
    await lock(this.tx, 'CreativePlan', v.creativePlanId);
    const root = await this.tx.creativePlan.findUniqueOrThrow({ where: { id: v.creativePlanId } });
    if (writable)
      invariant(!['ARCHIVED', 'SUPERSEDED'].includes(root.status), 'PRODUCTION_ARCHIVED');
    return v;
  }
  private async request(id: string) {
    const r = await this.tx.recordingRequest.findUniqueOrThrow({ where: { id } });
    await this.version(r.creativePlanVersionId);
    await lock(this.tx, 'RecordingRequest', id);
    const current = await this.tx.recordingRequest.findUniqueOrThrow({ where: { id } });
    invariant(current.status !== 'CANCELLED', 'RECORDING_REQUEST_CANCELLED');
    return current;
  }
  async prepare(versionId: string) {
    const v = await this.version(versionId);
    const requirements = specs.parse(v.requiredRecordingsJson ?? []);
    invariant(
      new Set(requirements.map((r) => r.clientKey)).size === requirements.length,
      'DUPLICATE_RECORDING_KEY',
    );
    const script = await this.tx.scriptVersion.findUniqueOrThrow({
      where: { id: v.scriptVersionId },
    });
    const segments = z
      .array(z.object({ id: z.string(), text: z.string() }))
      .parse(script.segmentsJson ?? []);
    invariant(
      requirements.every((r) =>
        r.scriptSegmentRefs.every((id) => segments.some((s) => s.id === id)),
      ),
      'RECORDING_SCRIPT_SEGMENT_MISSING',
    );
    const existing = await this.tx.recordingRequest.findMany({
      where: { creativePlanVersionId: versionId },
      orderBy: { createdAt: 'asc' },
    });
    if (existing.length) {
      invariant(existing.length === requirements.length, 'RECORDING_PACK_INCOMPLETE');
      await this.refresh(versionId);
      return existing;
    }
    const rows = [];
    for (const r of requirements) {
      const row = await this.tx.recordingRequest.create({
        data: {
          creativePlanVersionId: versionId,
          type: r.type,
          title: r.title,
          instructions: r.instructions,
          scriptSegmentRef: r.scriptSegmentRefs.length === 1 ? r.scriptSegmentRefs[0]! : null,
          // Exact complete request contract, including clientKey and plural segment refs.
          shotInstructionsJson: r,
          status: 'READY_TO_RECORD',
        },
      });
      await changed(
        this.tx,
        this.actor,
        'RecordingRequest.ready',
        'RecordingRequest',
        row.id,
        versionId,
      );
      rows.push(row);
    }
    await this.refresh(versionId);
    return rows;
  }
  async refresh(versionId: string) {
    const v = await this.version(versionId, false);
    const requirements = specs.parse(v.requiredRecordingsJson ?? []);
    const requests = await this.tx.recordingRequest.findMany({
      where: { creativePlanVersionId: versionId },
      include: { recordings: { include: { asset: true } } },
    });
    let recordingsReady = requests.length === requirements.length;
    for (const r of requests) {
      if (r.status === 'CANCELLED') {
        recordingsReady = false;
        continue;
      }
      const selected = r.recordings.some(
        (t) => t.status === 'SELECTED' && t.asset.status === 'READY' && !t.asset.deletedAt,
      );
      const status = selected ? 'ACCEPTED' : r.status === 'ACCEPTED' ? 'UPLOADED' : r.status;
      if (status !== r.status) {
        assertTransition('recordingRequest', r.status, status);
        await this.tx.recordingRequest.update({
          where: { id: r.id },
          data: { status, completedAt: selected ? await databaseTime(this.tx) : null },
        });
        await changed(
          this.tx,
          this.actor,
          'RecordingRequest.selectionChanged',
          'RecordingRequest',
          r.id,
          versionId,
        );
      }
      recordingsReady &&= selected;
    }
    const captureRequirements = captureSpecs.safeParse(v.requiredCapturesJson ?? []);

    /*
     * Invalid/legacy persisted capture requirements fail closed:
     * they can never make a CreativePlan ready, but they also do not
     * make refresh() throw while old rows still exist.
     */
    let capturesReady = captureRequirements.success;

    if (captureRequirements.success) {
      const successfulRuns = await this.tx.captureRun.findMany({
        where: {
          creativePlanVersionId: versionId,
          status: 'SUCCEEDED',
        },
        select: {
          captureScenarioVersion: {
            select: {
              browserConfigJson: true,
            },
          },
        },
      });

      const available = new Map<string, number>();

      for (const run of successfulRuns) {
        const parsed = persistedCaptureBrowserConfig.safeParse(
          run.captureScenarioVersion.browserConfigJson,
        );

        if (!parsed.success) {
          capturesReady = false;
          break;
        }

        const specVersionId = parsed.data.specVersionId;

        available.set(specVersionId, (available.get(specVersionId) ?? 0) + 1);
      }

      if (capturesReady) {
        for (const requirement of captureRequirements.data) {
          const count = available.get(requirement.captureScenarioVersionId) ?? 0;

          if (count <= 0) {
            capturesReady = false;
            break;
          }

          /*
           * One successful CaptureRun satisfies one capture request.
           * This matters when a plan requests the same scenario twice.
           */
          available.set(requirement.captureScenarioVersionId, count - 1);
        }
      }
    }

    const assets = z.array(z.string().uuid()).parse(v.requiredAssetsJson ?? []);
    const assetsReady =
      (await this.tx.asset.count({ where: { id: { in: assets }, ...validAsset } })) ===
      new Set(assets).size;
    const ready = recordingsReady && capturesReady && assetsReady;
    const latest = await this.tx.creativePlanVersion.findFirstOrThrow({
      where: { creativePlanId: v.creativePlanId },
      orderBy: { version: 'desc' },
    });
    if (latest.id === versionId) {
      const root = await this.tx.creativePlan.findUniqueOrThrow({
        where: { id: v.creativePlanId },
      });
      const status = ready ? 'READY_FOR_EDITING' : 'WAITING_FOR_INPUTS';
      if (!['ARCHIVED', 'SUPERSEDED'].includes(root.status) && root.status !== status) {
        await this.tx.creativePlan.update({ where: { id: root.id }, data: { status } });
        await changed(
          this.tx,
          this.actor,
          'CreativePlan.inputsChanged',
          'CreativePlan',
          root.id,
          versionId,
        );
      }
    }
    return { ready, recordingsReady, capturesReady, assetsReady };
  }
  async beginUpload(requestId: string, bucket: string) {
    assertHuman(this.actor);
    await this.request(requestId);
    const asset = await this.tx.asset.create({
      data: {
        kind: 'OTHER',
        sourceType: 'RECORDING',
        sourceEntityType: 'RecordingRequest',
        sourceEntityId: requestId,
        storageProvider: 'S3',
        bucket,
        objectKey: `originals/${randomUUID()}`,
        status: 'UPLOADING',
      },
    });
    await changed(this.tx, this.actor, 'Asset.uploadStarted', 'Asset', asset.id);
    return asset;
  }
  async finishUpload(
    assetId: string,
    metadata: RecordingAssetMetadata,
    evidence: Prisma.InputJsonValue,
  ) {
    assertHuman(this.actor);
    const a = await this.tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    invariant(
      a.sourceEntityType === 'RecordingRequest' && a.sourceEntityId,
      'ASSET_SOURCE_MISMATCH',
    );
    const r = await this.request(a.sourceEntityId);
    await lock(this.tx, 'Asset', assetId);
    const current = await this.tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    invariant(current.status === 'UPLOADING', 'UPLOAD_ALREADY_FINALIZED');
    const checked = assetMetadata.parse(metadata);
    invariant(
      checked.kind !== 'VIDEO' || (checked.width && checked.height && checked.fps),
      'VIDEO_METADATA_REQUIRED',
    );
    invariant(r.type !== 'VOICE' || (checked.audioChannels && checked.sampleRate), 'AUDIO_MISSING');
    invariant(
      !['GREEN_SCREEN_VIDEO', 'SCREEN_VIDEO', 'BROLL'].includes(r.type) || checked.kind === 'VIDEO',
      'VIDEO_MISSING',
    );
    const probeEvidence = z
      .object({
        probe: z.object({ assetId: z.literal(assetId), probeVersion: z.string().min(1) }),
        warnings: z.array(z.string()),
      })
      .parse(evidence);
    invariant(probeEvidence.probe.assetId === assetId, 'ASSET_PROBE_MISMATCH');
    await this.tx.asset.update({ where: { id: assetId }, data: { ...checked, status: 'READY' } });
    const last = await this.tx.recording.findFirst({
      where: { recordingRequestId: r.id },
      orderBy: { takeNumber: 'desc' },
    });
    const take = await this.tx.recording.create({
      data: { recordingRequestId: r.id, assetId, takeNumber: (last?.takeNumber ?? 0) + 1 },
    });
    if (r.status !== 'ACCEPTED')
      await this.tx.recordingRequest.update({
        where: { id: r.id },
        data: { status: 'UPLOADED', completedAt: null },
      });
    await this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: 'Asset.probed',
        subjectType: 'Asset',
        subjectId: assetId,
        afterJson: evidence,
      },
    });
    await changed(
      this.tx,
      this.actor,
      'Recording.uploaded',
      'Recording',
      take.id,
      r.creativePlanVersionId,
    );
    await this.refresh(r.creativePlanVersionId);
    return take;
  }
  async failUpload(assetId: string, code: string) {
    await lock(this.tx, 'Asset', assetId);
    const row = await this.tx.asset.updateMany({
      where: { id: assetId, status: 'UPLOADING' },
      data: { status: 'FAILED' },
    });
    if (row.count) {
      await this.tx.auditEvent.create({
        data: {
          ...this.actor,
          action: 'Asset.uploadFailed',
          subjectType: 'Asset',
          subjectId: assetId,
          afterJson: { code },
        },
      });
      await changed(this.tx, this.actor, 'Asset.failed', 'Asset', assetId);
    }
  }
  async select(takeId: string, status: 'SELECTED' | 'REJECTED' | 'UPLOADED') {
    assertHuman(this.actor);
    const take = await this.tx.recording.findUniqueOrThrow({ where: { id: takeId } });
    const r = await this.request(take.recordingRequestId);
    await lock(this.tx, 'Asset', take.assetId);
    const a = await this.tx.asset.findUniqueOrThrow({ where: { id: take.assetId } });
    if (status === 'SELECTED')
      invariant(a.status === 'READY' && !a.deletedAt, 'INVALID_RECORDING_ASSET');
    await this.tx.recording.update({ where: { id: takeId }, data: { status } });
    await changed(
      this.tx,
      this.actor,
      'Recording.selectionChanged',
      'Recording',
      takeId,
      r.creativePlanVersionId,
    );
    return this.refresh(r.creativePlanVersionId);
  }
  async quarantine(assetId: string) {
    const asset = await this.tx.asset.findUniqueOrThrow({ where: { id: assetId } });
    invariant(
      asset.sourceEntityType === 'RecordingRequest' && asset.sourceEntityId,
      'ASSET_SOURCE_MISMATCH',
    );
    const source = await this.tx.recordingRequest.findUniqueOrThrow({
      where: { id: asset.sourceEntityId },
      include: { creativePlanVersion: true },
    });
    const refs = await this.tx.recording.findMany({
      where: { assetId },
      include: { recordingRequest: { include: { creativePlanVersion: true } } },
    });
    const roots = [
      ...new Set([
        source.creativePlanVersion.creativePlanId,
        ...refs.map((r) => r.recordingRequest.creativePlanVersion.creativePlanId),
      ]),
    ].sort();
    for (const id of roots) await lock(this.tx, 'CreativePlan', id);
    await lock(this.tx, 'Asset', assetId);
    await this.tx.asset.update({ where: { id: assetId }, data: { status: 'QUARANTINED' } });
    await changed(this.tx, this.actor, 'Asset.quarantined', 'Asset', assetId);
    for (const id of new Set([
      source.creativePlanVersionId,
      ...refs.map((r) => r.recordingRequest.creativePlanVersionId),
    ]))
      await this.refresh(id);
  }
}
