import { z } from "zod";
import {
  ASSURANCE_DOSSIER_STATES,
  ASSURANCE_SCOPE_TYPES,
  type AssuranceDisclosurePolicy,
} from "../types/assurance.js";

export const assuranceDisclosurePolicySchema = z.object({
  companyIdentity: z.boolean().default(true),
  projectIdentity: z.boolean().default(false),
  taskTitles: z.boolean().default(false),
  totals: z.boolean().default(false),
  attachments: z.boolean().default(false),
}).strict();

export const createAssuranceDossierSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scopeType: z.enum(ASSURANCE_SCOPE_TYPES),
  projectId: z.string().uuid().nullable().optional(),
  scopeRef: z.string().trim().max(500).nullable().optional(),
  periodStart: z.string().datetime().nullable().optional(),
  periodEnd: z.string().datetime().nullable().optional(),
  issueIds: z.array(z.string().uuid()).max(500).optional(),
  disclosurePolicy: assuranceDisclosurePolicySchema.optional(),
}).superRefine((value, ctx) => {
  if (value.scopeType === "project" && !value.projectId) {
    ctx.addIssue({ code: "custom", path: ["projectId"], message: "projectId is required for project scope" });
  }
  if (value.scopeType === "period" && (!value.periodStart || !value.periodEnd)) {
    ctx.addIssue({ code: "custom", path: ["periodStart"], message: "periodStart and periodEnd are required for period scope" });
  }
});

export const updateAssuranceDossierSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(ASSURANCE_DOSSIER_STATES).optional(),
  scopeRef: z.string().trim().max(500).nullable().optional(),
  periodStart: z.string().datetime().nullable().optional(),
  periodEnd: z.string().datetime().nullable().optional(),
  disclosurePolicy: assuranceDisclosurePolicySchema.optional(),
}).strict();

export const sealAssuranceDossierSchema = z.object({
  expectedInputDigest: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

export const verifyAssuranceUploadSchema = z.object({
  publicId: z.string().trim().min(20).max(200).optional(),
  manifest: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => value.publicId || value.manifest, "publicId or manifest is required");

export type CreateAssuranceDossier = z.infer<typeof createAssuranceDossierSchema>;
export type UpdateAssuranceDossier = z.infer<typeof updateAssuranceDossierSchema>;
export type SealAssuranceDossier = z.infer<typeof sealAssuranceDossierSchema>;
export type AssuranceDisclosurePolicyInput = z.input<typeof assuranceDisclosurePolicySchema>;

export const DEFAULT_ASSURANCE_DISCLOSURE_POLICY: AssuranceDisclosurePolicy = {
  companyIdentity: true,
  projectIdentity: false,
  taskTitles: false,
  totals: false,
  attachments: false,
};
