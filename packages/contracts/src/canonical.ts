import { createHash } from 'node:crypto';

/** Sorted keys, preserved array order; rejects values JSON would silently lose. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  throw new Error('NON_JSON_VALUE');
}
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
/** Boundary check; context builders additionally use explicit field projections. Never log inputs. */
export function assertNoSecrets(value: unknown): void {
  if (typeof value === 'string') {
    if (
      /(?:Bearer\s+[\w.-]+|-----BEGIN .*PRIVATE KEY|(?:sk-|ghp_)[\w-]{16,}|(?:postgres(?:ql)?|redis):\/\/[^\s]+@)/i.test(
        value,
      )
    )
      throw new Error('SECRET_IN_CONTEXT');
  } else if (Array.isArray(value)) value.forEach(assertNoSecrets);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        /(?:password|secret|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)/i.test(
          key,
        ) ||
        /^(?:cookies?|storageState|storageStatePath|credentials)$/i.test(key)
      )
        throw new Error('SECRET_IN_CONTEXT');
      assertNoSecrets(item);
    }
  }
}
