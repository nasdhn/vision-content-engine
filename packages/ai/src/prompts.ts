import creator from '../prompts/creator.v1.json' with { type: 'json' };
import director from '../prompts/creative-director.v1.json' with { type: 'json' };
import editingIntelligence from '../prompts/editing-intelligence.v1.json' with { type: 'json' };
import { PromptArtifactSchema } from '@vision/contracts';
import { textHash } from '@vision/contracts/canonical';
import { invariant } from '@vision/domain';

const artifacts = [creator, director, editingIntelligence].map((p) => {
  const artifact = PromptArtifactSchema.parse(p);
  invariant(textHash(artifact.content) === artifact.contentHash, 'PROMPT_HASH_MISMATCH');
  return Object.freeze(artifact);
});
export function getPrompt(key: string, version: string) {
  const prompt = artifacts.find((p) => p.key === key && p.version === version);
  invariant(prompt, 'PROMPT_NOT_FOUND');
  return prompt;
}
