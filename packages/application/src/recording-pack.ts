import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Persistence } from '@vision/database';
import type { Actor, PrismaClient, Prisma } from '@vision/database';
import { RecordingRequestSpecSchema, ScriptSegmentSchema } from '@vision/contracts';
import { assertHuman, invariant, DomainError } from '@vision/domain';
import {
  mediaType,
  probeFile,
  recordingFeedback,
  createOwnedTemp,
  recoverOwnedTemps,
  CapacityGuard,
  CAPACITY_DEFAULTS,
} from '@vision/media';
import type { MediaProbe, PrivateStorage } from '@vision/media';

export const MAX_UPLOAD_BYTES = CAPACITY_DEFAULTS.maxUploadBytes;
export class RecordingPackService {
  private readonly persistence: Persistence;
  private uploading = 0;
  private previewing = 0;
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: PrivateStorage,
    private readonly probe: (file: string) => Promise<MediaProbe> = probeFile,
    private readonly capacity = new CapacityGuard(),
    private readonly tempRoot = tmpdir(),
  ) {
    this.persistence = new Persistence(db);
  }
  get maximumUploadBytes() {
    return this.capacity.policy.maxUploadBytes;
  }
  async prepare(actor: Actor, versionId: string) {
    assertHuman(actor);
    return this.persistence.transaction(actor, (u) => u.recordings.prepare(versionId));
  }
  async packs() {
    const roots = await this.db.creativePlan.findMany({
      where: { status: { notIn: ['ARCHIVED', 'SUPERSEDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const packs = [];
    for (const root of roots) {
      const v = root.versions[0];
      if (!v || !z.array(z.unknown()).parse(v.requiredRecordingsJson ?? []).length) continue;
      const script = await this.db.scriptVersion.findUniqueOrThrow({
        where: { id: v.scriptVersionId },
      });
      const segments = z.array(ScriptSegmentSchema).parse(script.segmentsJson ?? []);
      const requests = await this.db.recordingRequest.findMany({
        where: { creativePlanVersionId: v.id },
        orderBy: { createdAt: 'asc' },
        include: { recordings: { orderBy: { takeNumber: 'asc' }, include: { asset: true } } },
      });
      packs.push({
        versionId: v.id,
        version: v.version,
        status: root.status,
        requests: await Promise.all(
          requests.map(async (r) => {
            const spec = RecordingRequestSpecSchema.parse(r.shotInstructionsJson);
            return {
              id: r.id,
              status: r.status,
              ...spec,
              text: spec.scriptSegmentRefs
                .map((id) => segments.find((s) => s.id === id)?.text ?? '')
                .join('\n'),
              takes: await Promise.all(
                r.recordings.map(async (t) => {
                  const audit = await this.db.auditEvent.findFirst({
                    where: { action: 'Asset.probed', subjectId: t.assetId },
                    orderBy: { createdAt: 'desc' },
                  });
                  const feedback = z
                    .object({ warnings: z.array(z.string()) })
                    .safeParse(audit?.afterJson);
                  return {
                    id: t.id,
                    assetId: t.assetId,
                    number: t.takeNumber,
                    status: t.status,
                    assetStatus: t.asset.status,
                    durationMs: t.asset.durationMs,
                    kind: t.asset.kind,
                    warnings: feedback.success ? feedback.data.warnings : [],
                  };
                }),
              ),
            };
          }),
        ),
      });
    }
    return packs;
  }
  /** Idempotent catch-up for pre-existing Phase 2 plans. Runs at local service startup. */
  async prepareExisting() {
    const roots = await this.db.creativePlan.findMany({
      where: { status: { notIn: ['ARCHIVED', 'SUPERSEDED', 'DRAFT'] } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    for (const root of roots)
      if (root.versions[0])
        await this.persistence.transaction({ actorType: 'SYSTEM' }, (u) =>
          u.recordings.prepare(root.versions[0]!.id),
        );
  }
  async upload(
    actor: Actor,
    requestId: string,
    bytes: AsyncIterable<Uint8Array>,
    expectedChecksum?: string,
  ) {
    assertHuman(actor);
    invariant(this.uploading < 2, 'UPLOAD_CAPACITY_REACHED');
    if (expectedChecksum) invariant(/^[a-f0-9]{64}$/.test(expectedChecksum), 'INVALID_CHECKSUM');
    this.uploading++;
    let workspace: Awaited<ReturnType<typeof createOwnedTemp>> | undefined;
    let assetId: string | undefined;
    try {
      await this.capacity.require(this.tempRoot, this.capacity.policy.maxUploadBytes, requestId);
      const r = await this.db.recordingRequest.findUniqueOrThrow({ where: { id: requestId } });
      const spec = RecordingRequestSpecSchema.parse(r.shotInstructionsJson);
      const asset = await this.persistence.transaction(actor, (u) =>
        u.recordings.beginUpload(requestId, this.storage.bucket),
      );
      assetId = asset.id;
      workspace = await createOwnedTemp(this.tempRoot, 'upload', asset.id);
      const path = join(workspace.path, 'source');
      const file = await open(path, 'wx', 0o600);
      const hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of bytes) {
          size += chunk.byteLength;
          invariant(size <= this.capacity.policy.maxUploadBytes, 'UPLOAD_TOO_LARGE');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      invariant(size > 0, 'EMPTY_UPLOAD');
      const checksum = hash.digest('hex');
      invariant(!expectedChecksum || checksum === expectedChecksum, 'CHECKSUM_MISMATCH');
      const probe = await this.probe(path);
      const warnings = recordingFeedback(probe, spec.type, spec.targetDurationSec);
      const mimeType = mediaType(probe);
      await this.storage.put(asset.objectKey, path, size, mimeType);
      // Read after write verifies actual durable bytes, not client metadata or multipart ETags.
      await this.verify(asset.objectKey, checksum, size);
      return await this.persistence.transaction(actor, (u) =>
        u.recordings.finishUpload(
          asset.id,
          {
            kind: probe.video ? 'VIDEO' : 'AUDIO',
            checksumSha256: checksum,
            mimeType,
            sizeBytes: BigInt(size),
            durationMs: probe.durationMs,
            width: probe.video?.width ?? null,
            height: probe.video?.height ?? null,
            fps: probe.video?.fps ?? null,
            audioChannels: probe.audio?.channels ?? null,
            sampleRate: probe.audio?.sampleRate ?? null,
          },
          { probe: { ...probe, assetId: asset.id }, warnings } as Prisma.InputJsonValue,
        ),
      );
    } catch (error) {
      // Neither ffprobe output, filenames nor provider messages enter logs/business JSON.
      const code = error instanceof DomainError ? error.code : 'UPLOAD_FAILED';
      if (assetId)
        await this.persistence.transaction(actor, (u) => u.recordings.failUpload(assetId!, code));
      throw new DomainError(code);
    } finally {
      this.uploading--;
      await workspace?.cleanup();
    }
  }
  private async verify(key: string, checksum: string, expectedSize: number) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of await this.storage.get(key)) {
      size += chunk.byteLength;
      invariant(size <= expectedSize && size <= MAX_UPLOAD_BYTES, 'STORED_OBJECT_SIZE_MISMATCH');
      hash.update(chunk);
    }
    invariant(
      size === expectedSize && hash.digest('hex') === checksum,
      'STORED_OBJECT_CHECKSUM_MISMATCH',
    );
  }
  async preview(actor: Actor, assetId: string) {
    assertHuman(actor);
    invariant(this.previewing === 0, 'PREVIEW_CAPACITY_REACHED');
    this.previewing++;
    try {
      return await this.loadPreview(actor, assetId);
    } finally {
      this.previewing--;
    }
  }
  private async loadPreview(actor: Actor, assetId: string) {
    const a = await this.db.asset.findUniqueOrThrow({ where: { id: assetId } });
    invariant(
      a.storageProvider === 'S3' &&
        a.bucket === this.storage.bucket &&
        a.sourceType === 'RECORDING' &&
        a.status === 'READY' &&
        !a.deletedAt &&
        a.checksumSha256 &&
        a.sizeBytes,
      'ASSET_NOT_AVAILABLE',
    );
    const chunks: Uint8Array[] = [];
    try {
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of await this.storage.get(a.objectKey)) {
        size += chunk.byteLength;
        invariant(
          size <= Number(a.sizeBytes) && size <= MAX_UPLOAD_BYTES,
          'STORED_OBJECT_SIZE_MISMATCH',
        );
        hash.update(chunk);
        chunks.push(chunk);
      }
      invariant(
        size === Number(a.sizeBytes) && hash.digest('hex') === a.checksumSha256,
        'STORED_OBJECT_CHECKSUM_MISMATCH',
      );
    } catch {
      await this.persistence.transaction(actor, (u) => u.recordings.quarantine(assetId));
      throw new DomainError('ASSET_NOT_AVAILABLE');
    }
    return { bytes: Buffer.concat(chunks), mimeType: a.mimeType ?? 'application/octet-stream' };
  }
  select(actor: Actor, takeId: string, status: 'SELECTED' | 'REJECTED' | 'UPLOADED') {
    return this.persistence.transaction(actor, (u) => u.recordings.select(takeId, status));
  }
  /** Crash cleanup is allowed only after PostgreSQL already proves the upload terminal.
   * UPLOADING rows are intentionally retained: age alone never proves another process inactive. */
  async recoverInterrupted() {
    return recoverOwnedTemps(this.tempRoot, {
      kinds: ['upload'],
      isTerminal: async ({ operationId }) => {
        const asset = await this.db.asset.findUnique({
          where: { id: operationId },
          select: { status: true, sourceType: true, sourceEntityType: true },
        });
        if (!asset) return false;
        return (
          asset.sourceType === 'RECORDING' &&
          asset.sourceEntityType === 'RecordingRequest' &&
          ['READY', 'FAILED', 'QUARANTINED', 'ARCHIVED'].includes(asset.status)
        );
      },
    });
  }
}
