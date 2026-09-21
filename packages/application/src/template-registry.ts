import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { TemplateRuntimeContractSchema } from '@vision/contracts';
import { invariant } from '@vision/domain';

const record = z.record(z.string(), z.unknown());

const identitySchema = z
  .object({
    templateVersionId: z.string().uuid(),

    templateKey: z.string().min(1),

    name: z.string().min(1),

    version: z.number().int().positive(),

    sourceRevision: z.string().min(1),
  })
  .strict();

export const EXPECTED_TEMPLATE_KEYS = [
  'PRODUCT_DEMO',
  'MANUAL_TO_VISION',
  'PROBLEM_SOLUTION',
  'GREEN_SCREEN_EXPLAINER',
  'FOUNDER_STORY',
] as const;

export type ResolvedTemplate = {
  identity: z.infer<typeof identitySchema>;

  artifact: Record<string, unknown>;

  spec: z.infer<typeof TemplateRuntimeContractSchema>;
};

export class TemplateRegistry {
  private cache?: Promise<readonly ResolvedTemplate[]>;

  constructor(
    private readonly root = fileURLToPath(new URL('../template-seeds/', import.meta.url)),
  ) {}

  async list() {
    this.cache ??= this.load();

    return [...(await this.cache)];
  }

  async getByKey(key: string) {
    const template = (await this.list()).find((entry) => entry.identity.templateKey === key);

    invariant(template, 'TEMPLATE_NOT_FOUND');

    return template;
  }

  async getByVersionId(id: string) {
    const template = (await this.list()).find((entry) => entry.identity.templateVersionId === id);

    invariant(template, 'TEMPLATE_VERSION_NOT_FOUND');

    return template;
  }

  private async load() {
    const files = (await readdir(this.root)).filter((name) => name.endsWith('.json')).sort();

    invariant(files.length === EXPECTED_TEMPLATE_KEYS.length, 'TEMPLATE_SEED_COUNT_MISMATCH');

    const templates: ResolvedTemplate[] = [];

    for (const file of files) {
      const artifact = record.parse(
        JSON.parse(await readFile(new URL(file, `file://${this.root}/`), 'utf8')) as unknown,
      );

      const identity = identitySchema.parse({
        templateVersionId: artifact.templateVersionId,

        templateKey: artifact.templateKey,

        name: artifact.name,

        version: artifact.version,

        sourceRevision: artifact.sourceRevision,
      });

      const runtime = Object.fromEntries(
        Object.entries(artifact).filter(
          ([key]) => !['templateKey', 'name', 'version', 'sourceRevision'].includes(key),
        ),
      );

      const spec = TemplateRuntimeContractSchema.parse(runtime);

      invariant(
        spec.templateVersionId === identity.templateVersionId,
        'TEMPLATE_VERSION_ID_MISMATCH',
      );

      templates.push({
        identity,
        artifact,
        spec,
      });
    }

    invariant(
      new Set(templates.map((entry) => entry.identity.templateKey)).size === templates.length,
      'DUPLICATE_TEMPLATE_KEY',
    );

    invariant(
      new Set(templates.map((entry) => entry.identity.templateVersionId)).size === templates.length,
      'DUPLICATE_TEMPLATE_VERSION_ID',
    );

    for (const key of EXPECTED_TEMPLATE_KEYS)
      invariant(
        templates.some((entry) => entry.identity.templateKey === key),
        'TEMPLATE_SEED_MISSING',
      );

    return Object.freeze(
      EXPECTED_TEMPLATE_KEYS.map((key) => {
        const template = templates.find((entry) => entry.identity.templateKey === key);

        invariant(template, 'TEMPLATE_SEED_MISSING');

        return template;
      }),
    );
  }
}
