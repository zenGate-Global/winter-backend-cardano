import { createHash, randomUUID } from 'node:crypto';

// A client that retries a POST whose response it never saw must not get a
// second transaction. Without a key the controller mints a fresh identifier per
// request, so a retry of a timed out tokenize produces a second token for the
// same commodity.
//
// The caller sends an optional `Idempotency-Key` header. The same key on the
// same route always maps to the same job identifier, so the retry finds the row
// that the first attempt created and returns it.
//
// pg-boss stores its job identifier in a `uuid` column, so the derived value
// must be a valid UUID. This builds one from a digest and sets the version and
// variant bits, which is version 8 in RFC 9562: the layout of the remaining
// bits is defined by the implementation.
const NAMESPACE = 'winter-backend-cardano/idempotency/v1';

export type IdempotencyScope =
  | 'tokenize-commodity'
  | 'recreate-commodity'
  | 'spend-commodity';

// The maximum key length a caller may send. A key is an opaque identifier, so
// this only stops an unbounded header from reaching the digest.
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

function stableStringify(value: object): string {
  const serialized = JSON.stringify(value, (_key, nestedValue) => {
    if (
      nestedValue === null ||
      typeof nestedValue !== 'object' ||
      Array.isArray(nestedValue)
    ) {
      return nestedValue;
    }
    const object = nestedValue as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]]),
    );
  });
  if (serialized === undefined) {
    throw new TypeError('Request body must be serializable');
  }
  return serialized;
}

export function deriveRequestFingerprint(body: object): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

export function deriveJobId(scope: IdempotencyScope, key: string): string {
  const digest = createHash('sha256')
    .update(`${NAMESPACE}\u0000${scope}\u0000${key}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// The scope keeps the same key on two different routes apart, so a caller that
// reuses one key for a tokenize and a spend gets two separate jobs.
export function resolveJobId(
  scope: IdempotencyScope,
  key: string | undefined,
): string {
  const trimmed = key?.trim();
  if (!trimmed) {
    return randomUUID();
  }
  return deriveJobId(scope, trimmed);
}
