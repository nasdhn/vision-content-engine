import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Persistence } from '../../../packages/database/src/index.js';
import type { PrismaClient } from '../../../packages/database/src/index.js';
import type { PrivateStorage } from '../../../packages/media/src/index.js';
export const human = { actorType: 'USER', actorId: 'fixture-director' } as const;
export const requestSpec = {
  clientKey: 'voice-1',
  type: 'VOICE',
  title: 'Une voix naturelle',
  instructions: 'Enregistrez votre voix au calme.',
  scriptSegmentRefs: ['line-1'],
  targetDurationSec: 1,
  shot: {
    framing: 'Plan taille',
    presenterPosition: 'LEFT',
    gestureDirection: 'RIGHT',
    background: 'NATURAL',
  },
} as const;
export function wav() {
  const samples = 8000,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 16000) * 10000), 44 + i * 2);
  return bytes;
}
export async function* chunks(bytes: Buffer = wav()) {
  yield bytes.subarray(0, 32);
  yield bytes.subarray(32);
}
export class MemoryStorage implements PrivateStorage {
  readonly bucket = 'fixture-private';
  readonly objects = new Map<string, Buffer>();
  failPut = false;
  failGet = false;
  corrupt = false;
  async put(key: string, path: string) {
    if (this.failPut) throw new Error('sensitive-provider-error');
    if (this.objects.has(key)) throw new Error('IMMUTABLE_OBJECT');
    this.objects.set(key, await readFile(path));
  }
  async get(key: string) {
    if (this.failGet) throw new Error('sensitive-read-error');
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error('OBJECT_MISSING');
    return chunks(this.corrupt ? Buffer.alloc(bytes.length) : bytes);
  }
}
export async function recordingGraph(db: PrismaClient, capture = false) {
  const p = new Persistence(db);
  const template = await db.template.create({ data: { key: randomUUID(), name: 'fixture' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'fixture' } });
  return p.transaction(human, async (u) => {
    const campaign = await u.createCampaign({ name: 'fixture', slug: randomUUID() });
    const brief = await u.createBrief(campaign.id, 'fixture');
    const bv = await u.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
    const concept = await u.createConcept(brief.id);
    const cv = await u.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: bv.id,
      title: 'fixture',
      creatorType: 'HUMAN',
    });
    await u.submitConcept(cv.id);
    await u.decideConcept(cv.id, 'APPROVED');
    const script = await u.createScript(concept.id);
    const plan = await u.createCreativePlan(concept.id);
    const tv = await u.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'fixture',
      inputSchemaJson: {},
    });
    const pv = await u.versions.editingProfileVersion({ editingProfileId: profile.id });
    const sv = await u.versions.scriptVersion({
      scriptId: script.id,
      conceptVersionId: cv.id,
      fullText: 'Voici comment retrouver votre preuve.',
      segmentsJson: [{ id: 'line-1', text: 'Voici comment retrouver votre preuve.' }],
      createdByType: 'HUMAN',
    });
    const cpv = await u.versions.creativePlanVersion({
      creativePlanId: plan.id,
      scriptVersionId: sv.id,
      primaryFormat: 'VOICE',
      templateVersionId: tv.id,
      editingProfileVersionId: pv.id,
      scenePlanJson: {},
      requiredRecordingsJson: [requestSpec],
      requiredCapturesJson: capture ? [{ clientKey: 'capture-required' }] : [],
      requiredAssetsJson: [],
    });
    await u.markProductionReady(script.id, plan.id);
    const requests = await u.recordings.prepare(cpv.id);
    const request = requests[0]!;
    return { cpv, request, plan, sv, cv, tv, pv };
  });
}
