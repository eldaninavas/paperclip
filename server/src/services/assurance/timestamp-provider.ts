import type { AssuranceTimestampState } from "@paperclipai/shared";

export interface AssuranceTimestampResult {
  provider: "disabled" | "rfc3161" | "nom151_psc";
  status: AssuranceTimestampState;
  receipt: Buffer | null;
  contentType: string | null;
}

export interface AssuranceTimestampProvider {
  readonly provider: AssuranceTimestampResult["provider"];
  timestampDigest(digestHex: string): Promise<AssuranceTimestampResult>;
}

export class DisabledAssuranceTimestampProvider implements AssuranceTimestampProvider {
  readonly provider = "disabled" as const;
  async timestampDigest(): Promise<AssuranceTimestampResult> {
    return { provider: this.provider, status: "not_configured", receipt: null, contentType: null };
  }
}

export function resolveAssuranceTimestampProvider(): AssuranceTimestampProvider {
  // Real RFC 3161 and NOM-151 PSC clients plug in here. Disabled never fabricates a receipt.
  return new DisabledAssuranceTimestampProvider();
}
