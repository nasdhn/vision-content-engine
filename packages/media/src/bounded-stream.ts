import { invariant } from '@vision/domain';
/** Iteration closes upstream on rejection/cancellation as well as success. */
export async function* boundedBytes(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
  declaredSize?: number,
) {
  invariant(Number.isSafeInteger(maximum) && maximum > 0, 'INVALID_CAPACITY_POLICY');
  invariant(
    declaredSize === undefined ||
      (Number.isSafeInteger(declaredSize) && declaredSize >= 0 && declaredSize <= maximum),
    'ARTIFACT_TOO_LARGE',
  );
  let size = 0;
  for await (const chunk of source) {
    invariant(chunk instanceof Uint8Array, 'INVALID_ARTIFACT_STREAM');
    size += chunk.byteLength;
    invariant(
      size <= maximum && (declaredSize === undefined || size <= declaredSize),
      'ARTIFACT_TOO_LARGE',
    );
    yield chunk;
  }
  invariant(declaredSize === undefined || size === declaredSize, 'ARTIFACT_SIZE_MISMATCH');
}
