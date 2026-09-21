import { expect, it } from 'vitest';

import {
  EXPECTED_TEMPLATE_KEYS,
  TemplateRegistry,
} from '../../packages/application/src/template-registry.js';

it('loads exactly the five frozen V1 templates in canonical order', async () => {
  const templates = await new TemplateRegistry().list();

  expect(templates).toHaveLength(5);

  expect(templates.map((entry) => entry.identity.templateKey)).toEqual(EXPECTED_TEMPLATE_KEYS);

  expect(new Set(templates.map((entry) => entry.identity.templateVersionId)).size).toBe(5);
});

it('resolves templates by key and canonical version UUID', async () => {
  const registry = new TemplateRegistry();

  const template = await registry.getByKey('PRODUCT_DEMO');

  expect(template.identity.templateVersionId).toBe('018f2000-0000-7000-8000-000000000001');

  await expect(registry.getByVersionId(template.identity.templateVersionId)).resolves.toEqual(
    template,
  );
});
