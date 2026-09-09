import { createHash } from "node:crypto";
import { canonicalizeAssuranceJson } from "./canonicalizer.js";

export function assuranceSha256Bytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assuranceSha256(value: unknown): string {
  return assuranceSha256Bytes(Buffer.from(canonicalizeAssuranceJson(value), "utf8"));
}
