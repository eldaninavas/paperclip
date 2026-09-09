export const ASSURANCE_POLICY_VERSION = "foundation.assurance-policy.v1" as const;
export const ASSURANCE_MANIFEST_SCHEMA_VERSION = "foundation.assurance-manifest.v1" as const;

export const ASSURANCE_RUN_RECORD_STATES = ["provisional", "finalized", "incomplete"] as const;
export const ASSURANCE_TASK_VALIDATION_STATES = ["pending", "valid", "incomplete", "rejected", "stale"] as const;
export const ASSURANCE_DOSSIER_STATES = ["draft", "ready", "blocked", "sealing", "sealed", "superseded", "revoked"] as const;
export const ASSURANCE_SCOPE_TYPES = ["project", "period", "client", "contract", "process", "custom"] as const;
export const ASSURANCE_TIMESTAMP_STATES = ["not_configured", "pending", "valid", "failed"] as const;
export const ASSURANCE_COST_COMPLETENESS = ["reported", "partial", "missing", "estimated"] as const;

export type AssuranceRunRecordState = typeof ASSURANCE_RUN_RECORD_STATES[number];
export type AssuranceTaskValidationState = typeof ASSURANCE_TASK_VALIDATION_STATES[number];
export type AssuranceDossierState = typeof ASSURANCE_DOSSIER_STATES[number];
export type AssuranceScopeType = typeof ASSURANCE_SCOPE_TYPES[number];
export type AssuranceTimestampState = typeof ASSURANCE_TIMESTAMP_STATES[number];
export type AssuranceCostCompleteness = typeof ASSURANCE_COST_COMPLETENESS[number];

export interface AssuranceDisclosurePolicy {
  companyIdentity: boolean;
  projectIdentity: boolean;
  taskTitles: boolean;
  totals: boolean;
  attachments: boolean;
}

export interface AssuranceCheck {
  key: string;
  state: "passed" | "failed" | "missing" | "not_applicable";
  label: string;
  detail?: string | null;
}

export interface AssuranceTotals {
  runs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  deliverables: number;
  approvals: number;
  costCompleteness: AssuranceCostCompleteness;
}

export interface AssuranceTaskValidationDto {
  id: string;
  issueId: string;
  projectId: string | null;
  sourceStatusVersion: number;
  inputDigest: string;
  policyVersion: string;
  state: AssuranceTaskValidationState;
  checks: AssuranceCheck[];
  totals: AssuranceTotals;
  snapshot: Record<string, unknown>;
  snapshotSha256: string;
  validatedAt: string;
}

export interface AssuranceDossierSummaryDto {
  id: string;
  publicId: string;
  title: string;
  scopeType: AssuranceScopeType;
  projectId: string | null;
  status: AssuranceDossierState;
  taskCount: number;
  exceptionCount: number;
  updatedAt: string;
  sealedAt: string | null;
}

export interface AssuranceOverviewDto {
  readyToSeal: number;
  requiresAttention: number;
  drafts: number;
  sealed: number;
  recentDossiers: AssuranceDossierSummaryDto[];
  exceptions: Array<{ issueId: string; title: string; state: AssuranceTaskValidationState; reason: string }>;
}

export interface AssuranceDossierDetailDto extends AssuranceDossierSummaryDto {
  inputDigest: string;
  scopeRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  disclosurePolicy: AssuranceDisclosurePolicy;
  items: Array<{
    id: string;
    issueId: string;
    issueTitle: string;
    taskValidationId: string;
    inclusionState: string;
    inclusionReason: string;
    validation: AssuranceTaskValidationDto;
  }>;
  versions: Array<{
    id: string;
    version: number;
    manifestSha256: string;
    signatureAlgorithm: string | null;
    signingKeyId: string | null;
    timestampProvider: string | null;
    timestampStatus: AssuranceTimestampState;
    sealedByUserId: string;
    sealedAt: string;
  }>;
}

export interface AssurancePublicVerificationDto {
  found: boolean;
  integrity: "valid" | "altered" | "not_found";
  status?: "current" | "superseded" | "revoked";
  publicId?: string;
  title?: string;
  company?: string;
  project?: string | null;
  issuedAt?: string;
  manifestSha256?: string;
  signatureStatus?: "not_configured" | "local_dev" | "valid" | "invalid";
  timestampStatus?: AssuranceTimestampState;
}
