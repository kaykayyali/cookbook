// UTF-8-aware JSON bounding shared by extraction and durable provenance.

const encoder = new TextEncoder();

export function utf8ByteLength(value) {
  return encoder.encode(String(value)).byteLength;
}

function safeSerialize(value) {
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

/**
 * Serialize to valid JSON no larger than maxBytes when UTF-8 encoded.
 * Oversized values become a useful envelope containing a prefix of the
 * original serialization; the prefix is a JSON string, so truncation can
 * never make the outer document invalid JSON.
 */
export function boundedJsonString(value, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 2) throw new RangeError('invalid_json_byte_cap');

  const serialized = safeSerialize(value);
  const originalBytes = utf8ByteLength(serialized);
  if (originalBytes <= maxBytes) return serialized;

  const envelope = {
    truncated: true,
    originalLength: serialized.length,
    originalBytes,
    jsonPrefix: '',
  };
  if (utf8ByteLength(JSON.stringify(envelope)) > maxBytes) return '{}';

  let low = 0;
  let high = serialized.length;
  let bounded = JSON.stringify(envelope);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    envelope.jsonPrefix = serialized.slice(0, middle);
    const candidate = JSON.stringify(envelope);
    if (utf8ByteLength(candidate) <= maxBytes) {
      bounded = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return bounded;
}

export function boundedJsonValue(value, maxBytes) {
  return JSON.parse(boundedJsonString(value, maxBytes));
}
