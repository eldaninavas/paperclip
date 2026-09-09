import { ASSURANCE_MANIFEST_SCHEMA_VERSION } from "@paperclipai/shared";
import { assuranceSha256 } from "./hasher.js";

export function buildAssuranceManifest(input: {
  dossier: {
    id: string;
    publicId: string;
    companyId: string;
    title: string;
    scopeType: string;
    projectId: string | null;
    scopeRef: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    disclosurePolicy: Record<string, unknown>;
  };
  version: number;
  sealedAt: Date;
  items: Array<{
    issueId: string;
    taskValidationId: string;
    inclusionReason: string;
    validation: {
      inputDigest: string;
      snapshotSha256: string;
      state: string;
      sourceStatusVersion: number;
      totalsJson: Record<string, unknown>;
    };
  }>;
}) {
  const totals = input.items.reduce((sum, item) => {
    const row = item.validation.totalsJson;
    return {
      runs: sum.runs + Number(row.runs ?? 0),
      inputTokens: sum.inputTokens + Number(row.inputTokens ?? 0),
      cachedInputTokens: sum.cachedInputTokens + Number(row.cachedInputTokens ?? 0),
      outputTokens: sum.outputTokens + Number(row.outputTokens ?? 0),
      costCents: sum.costCents + Number(row.costCents ?? 0),
      deliverables: sum.deliverables + Number(row.deliverables ?? 0),
      approvals: sum.approvals + Number(row.approvals ?? 0),
    };
  }, { runs: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costCents: 0, deliverables: 0, approvals: 0 });
  const manifest = {
    schemaVersion: ASSURANCE_MANIFEST_SCHEMA_VERSION,
    dossier: {
      id: input.dossier.id,
      publicId: input.dossier.publicId,
      companyId: input.dossier.companyId,
      title: input.dossier.title,
      scopeType: input.dossier.scopeType,
      projectId: input.dossier.projectId,
      scopeRef: input.dossier.scopeRef,
      periodStart: input.dossier.periodStart?.toISOString() ?? null,
      periodEnd: input.dossier.periodEnd?.toISOString() ?? null,
      disclosurePolicy: input.dossier.disclosurePolicy,
    },
    version: input.version,
    sealedAt: input.sealedAt.toISOString(),
    taskValidations: input.items.map((item) => ({
      issueId: item.issueId,
      taskValidationId: item.taskValidationId,
      inputDigest: item.validation.inputDigest,
      snapshotSha256: item.validation.snapshotSha256,
      sourceStatusVersion: item.validation.sourceStatusVersion,
      state: item.validation.state,
      inclusionReason: item.inclusionReason,
    })),
    totals,
    statements: {
      scope: "This manifest records evidence retained by Foundation for the listed task validations.",
      limitations: "It does not represent tax-authority validation, a fiscal audit, deductibility advice, or proof of the truth, quality, or necessity of the work.",
    },
  };
  return { manifest, manifestSha256: assuranceSha256(manifest), totals };
}
