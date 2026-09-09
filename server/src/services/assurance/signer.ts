import { createPrivateKey, sign as nodeSign } from "node:crypto";

export type AssuranceSignature = {
  provider: "disabled" | "local_dev" | "kms";
  algorithm: string | null;
  value: string | null;
  keyId: string | null;
  productionTrusted: boolean;
};

export interface AssuranceSigner {
  readonly provider: AssuranceSignature["provider"];
  signDigest(digestHex: string): Promise<AssuranceSignature>;
}

export class DisabledAssuranceSigner implements AssuranceSigner {
  readonly provider = "disabled" as const;
  async signDigest(): Promise<AssuranceSignature> {
    return { provider: this.provider, algorithm: null, value: null, keyId: null, productionTrusted: false };
  }
}

export class LocalDevAssuranceSigner implements AssuranceSigner {
  readonly provider = "local_dev" as const;
  constructor(private readonly privateKeyPem: string, private readonly keyId = "local-dev") {}
  async signDigest(digestHex: string): Promise<AssuranceSignature> {
    const value = nodeSign(null, Buffer.from(digestHex, "hex"), createPrivateKey(this.privateKeyPem)).toString("base64");
    return { provider: this.provider, algorithm: "Ed25519", value, keyId: this.keyId, productionTrusted: false };
  }
}

export function resolveAssuranceSigner(): AssuranceSigner {
  const provider = process.env.ASSURANCE_SIGNER_PROVIDER?.trim() || "disabled";
  if (provider === "local_dev" && process.env.ASSURANCE_LOCAL_DEV_PRIVATE_KEY) {
    return new LocalDevAssuranceSigner(
      process.env.ASSURANCE_LOCAL_DEV_PRIVATE_KEY.replaceAll("\\n", "\n"),
      process.env.ASSURANCE_SIGNING_KEY_ID || "local-dev",
    );
  }
  // KMS is intentionally an interface boundary until a real operator-selected provider is configured.
  return new DisabledAssuranceSigner();
}
