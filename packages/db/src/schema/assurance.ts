import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const assuranceRunRecords = pgTable("assurance_run_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
  issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  sourceDigest: text("source_digest").notNull(),
  snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>().notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
  costCompleteness: text("cost_completeness").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  supersedesRecordId: uuid("supersedes_record_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runDigestUq: uniqueIndex("assurance_run_records_run_digest_uq").on(table.runId, table.sourceDigest),
  companyRunIdx: index("assurance_run_records_company_run_idx").on(table.companyId, table.runId),
  issueCapturedIdx: index("assurance_run_records_issue_captured_idx").on(table.issueId, table.capturedAt),
}));

export const assuranceTaskValidations = pgTable("assurance_task_validations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  sourceStatusVersion: integer("source_status_version").notNull(),
  inputDigest: text("input_digest").notNull(),
  policyVersion: text("policy_version").notNull(),
  state: text("state").notNull(),
  checksJson: jsonb("checks_json").$type<Record<string, unknown>>().notNull(),
  totalsJson: jsonb("totals_json").$type<Record<string, unknown>>().notNull(),
  snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>().notNull(),
  snapshotSha256: text("snapshot_sha256").notNull(),
  validatedAt: timestamp("validated_at", { withTimezone: true }).notNull(),
  supersedesValidationId: uuid("supersedes_validation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  issueDigestUq: uniqueIndex("assurance_task_validations_issue_digest_uq").on(table.issueId, table.inputDigest),
  companyStateIdx: index("assurance_task_validations_company_state_idx").on(table.companyId, table.state),
  issueValidatedIdx: index("assurance_task_validations_issue_validated_idx").on(table.issueId, table.validatedAt),
}));

export const assuranceDossiers = pgTable("assurance_dossiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  scopeType: text("scope_type").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  scopeRef: text("scope_ref"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  status: text("status").notNull().default("draft"),
  disclosurePolicy: jsonb("disclosure_policy").$type<Record<string, unknown>>().notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  publicIdUq: uniqueIndex("assurance_dossiers_public_id_uq").on(table.publicId),
  companyStatusIdx: index("assurance_dossiers_company_status_idx").on(table.companyId, table.status),
  projectIdx: index("assurance_dossiers_project_idx").on(table.projectId),
}));

export const assuranceDossierItems = pgTable("assurance_dossier_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  dossierId: uuid("dossier_id").notNull().references(() => assuranceDossiers.id, { onDelete: "cascade" }),
  taskValidationId: uuid("task_validation_id").notNull().references(() => assuranceTaskValidations.id),
  issueId: uuid("issue_id").notNull().references(() => issues.id),
  inclusionState: text("inclusion_state").notNull(),
  inclusionReason: text("inclusion_reason").notNull(),
  exceptionJson: jsonb("exception_json").$type<Record<string, unknown>>(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dossierValidationUq: uniqueIndex("assurance_dossier_items_dossier_validation_uq").on(table.dossierId, table.taskValidationId),
  companyDossierIdx: index("assurance_dossier_items_company_dossier_idx").on(table.companyId, table.dossierId),
}));

export const assuranceDossierVersions = pgTable("assurance_dossier_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  dossierId: uuid("dossier_id").notNull().references(() => assuranceDossiers.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  manifestSchemaVersion: text("manifest_schema_version").notNull(),
  manifestJson: jsonb("manifest_json").$type<Record<string, unknown>>().notNull(),
  manifestSha256: text("manifest_sha256").notNull(),
  xmlAssetId: uuid("xml_asset_id").references(() => assets.id),
  pdfAssetId: uuid("pdf_asset_id").references(() => assets.id),
  bundleAssetId: uuid("bundle_asset_id").references(() => assets.id),
  signatureAlgorithm: text("signature_algorithm"),
  signatureValue: text("signature_value"),
  signingKeyId: text("signing_key_id"),
  timestampProvider: text("timestamp_provider"),
  timestampStatus: text("timestamp_status").notNull(),
  timestampReceiptAssetId: uuid("timestamp_receipt_asset_id").references(() => assets.id),
  sealedByUserId: text("sealed_by_user_id").notNull(),
  sealedAt: timestamp("sealed_at", { withTimezone: true }).notNull(),
  supersedesVersionId: uuid("supersedes_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dossierVersionUq: uniqueIndex("assurance_dossier_versions_dossier_version_uq").on(table.dossierId, table.version),
  companyDossierIdx: index("assurance_dossier_versions_company_dossier_idx").on(table.companyId, table.dossierId),
}));

export const assuranceVerificationEvents = pgTable("assurance_verification_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id").references(() => assuranceDossiers.id, { onDelete: "set null" }),
  dossierVersionId: uuid("dossier_version_id").references(() => assuranceDossierVersions.id, { onDelete: "set null" }),
  result: text("result").notNull(),
  method: text("method").notNull(),
  securityJson: jsonb("security_json").$type<Record<string, unknown>>().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dossierVerifiedIdx: index("assurance_verification_events_dossier_verified_idx").on(table.dossierId, table.verifiedAt),
}));

export const assuranceJobs = pgTable("assurance_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dedupeUq: uniqueIndex("assurance_jobs_dedupe_uq").on(table.dedupeKey),
  readyIdx: index("assurance_jobs_ready_idx").on(table.status, table.availableAt),
  companyIdx: index("assurance_jobs_company_idx").on(table.companyId, table.createdAt),
}));
