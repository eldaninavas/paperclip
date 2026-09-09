function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Assurance canonical JSON cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
        .map((key) => [key, normalize(source[key])]),
    );
  }
  throw new TypeError(`Unsupported Assurance canonical JSON value: ${typeof value}`);
}

/** Stable UTF-8 JSON representation compatible with the JCS object-key ordering rules. */
export function canonicalizeAssuranceJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}
