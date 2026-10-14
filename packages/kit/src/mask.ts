// Masks secrets before anything is written to a report.
const SECRET = /(token|password|passwd|otp|pin|secret|authorization|cookie|session|api[-_]?key)/i;
const MAX_BODY = 2048;

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET.test(k) ? '***' : maskValue(v)]),
    );
  }
  return value;
}

export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (SECRET.test(key)) u.searchParams.set(key, '***');
    return u.toString();
  } catch {
    return url;
  }
}

export function maskBody(text: string): string {
  let out: string;
  try {
    out = JSON.stringify(maskValue(JSON.parse(text)));
  } catch {
    out = text.replace(
      /("?(?:token|password|passwd|otp|pin|secret|authorization|cookie|session|api[-_]?key)"?\s*[:=]\s*)"?[^",&\s}]+"?/gi,
      '$1"***"',
    );
  }
  return out.length > MAX_BODY ? `${out.slice(0, MAX_BODY)}… [cut at 2 KB]` : out;
}
