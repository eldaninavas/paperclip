import type {
  AssuranceDossierDetailDto,
  AssuranceDossierSummaryDto,
  AssuranceOverviewDto,
  AssurancePublicVerificationDto,
  AssuranceTaskValidationDto,
  CreateAssuranceDossier,
  UpdateAssuranceDossier,
} from "@paperclipai/shared";
import { api } from "./client";

export interface ProjectAssuranceResponse {
  project: { id: string; name: string };
  coverage: {
    tasks: number;
    valid: number;
    incomplete: number;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    deliverables: number;
    approvals: number;
  };
  validations: Array<AssuranceTaskValidationDto & { checksJson?: unknown; totalsJson?: unknown }>;
  dossiers: AssuranceDossierSummaryDto[];
}

export interface IssueAssuranceResponse {
  issueId: string;
  latestValidation: AssuranceTaskValidationDto | null;
  revisions: AssuranceTaskValidationDto[];
}

export const assuranceApi = {
  overview: (companyId: string) => api.get<AssuranceOverviewDto>(`/companies/${companyId}/assurance/overview`),
  listDossiers: (companyId: string) => api.get<AssuranceDossierSummaryDto[]>(`/companies/${companyId}/assurance/dossiers`),
  createDossier: (companyId: string, input: CreateAssuranceDossier) =>
    api.post<AssuranceDossierDetailDto>(`/companies/${companyId}/assurance/dossiers`, input),
  project: (projectId: string) => api.get<ProjectAssuranceResponse>(`/projects/${projectId}/assurance`),
  createProjectDossier: (projectId: string, title: string) =>
    api.post<AssuranceDossierDetailDto>(`/projects/${projectId}/assurance/dossiers`, { title, scopeType: "project", projectId }),
  issue: (issueId: string) => api.get<IssueAssuranceResponse>(`/issues/${issueId}/assurance`),
  validateIssue: (issueId: string) => api.post<AssuranceTaskValidationDto>(`/issues/${issueId}/assurance/validate`, {}),
  dossier: (dossierId: string) => api.get<AssuranceDossierDetailDto>(`/assurance/dossiers/${dossierId}`),
  updateDossier: (dossierId: string, input: UpdateAssuranceDossier) =>
    api.patch<AssuranceDossierDetailDto>(`/assurance/dossiers/${dossierId}`, input),
  refreshDossier: (dossierId: string) => api.post<AssuranceDossierDetailDto>(`/assurance/dossiers/${dossierId}/refresh`, {}),
  requestApproval: (dossierId: string) => api.post<{ approval: { id: string; status: string }; inputDigest: string }>(`/assurance/dossiers/${dossierId}/request-approval`, {}),
  sealDossier: (dossierId: string, expectedInputDigest: string) =>
    api.post(`/assurance/dossiers/${dossierId}/seal`, { expectedInputDigest }),
  verify: (publicId: string, method: "public_id" | "qr" = "public_id") =>
    api.get<AssurancePublicVerificationDto>(`/public/assurance/verify/${encodeURIComponent(publicId)}?method=${method}`),
  verifyManifest: (manifest: Record<string, unknown>) =>
    api.post<AssurancePublicVerificationDto>("/public/assurance/verify", { manifest }),
  artifactUrl: (dossierId: string, artifact: "manifest" | "xml" | "pdf" | "bundle") => {
    const suffix = artifact === "manifest" ? "manifest" : artifact === "xml" ? "manifest.xml" : artifact === "pdf" ? "report.pdf" : "bundle.zip";
    return `/api/assurance/dossiers/${dossierId}/${suffix}`;
  },
};
