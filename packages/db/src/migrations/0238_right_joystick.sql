CREATE TABLE "assurance_dossier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"task_validation_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"inclusion_state" text NOT NULL,
	"inclusion_reason" text NOT NULL,
	"exception_json" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assurance_dossier_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"manifest_schema_version" text NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"manifest_sha256" text NOT NULL,
	"xml_asset_id" uuid,
	"pdf_asset_id" uuid,
	"bundle_asset_id" uuid,
	"signature_algorithm" text,
	"signature_value" text,
	"signing_key_id" text,
	"timestamp_provider" text,
	"timestamp_status" text NOT NULL,
	"timestamp_receipt_asset_id" uuid,
	"sealed_by_user_id" text NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	"supersedes_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assurance_dossiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"scope_type" text NOT NULL,
	"project_id" uuid,
	"scope_ref" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"disclosure_policy" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assurance_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assurance_run_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid,
	"status" text NOT NULL,
	"source_digest" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"cost_completeness" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"supersedes_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assurance_task_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid,
	"source_status_version" integer NOT NULL,
	"input_digest" text NOT NULL,
	"policy_version" text NOT NULL,
	"state" text NOT NULL,
	"checks_json" jsonb NOT NULL,
	"totals_json" jsonb NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"supersedes_validation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assurance_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_id" uuid,
	"dossier_version_id" uuid,
	"result" text NOT NULL,
	"method" text NOT NULL,
	"security_json" jsonb NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assurance_dossier_items" ADD CONSTRAINT "assurance_dossier_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_items" ADD CONSTRAINT "assurance_dossier_items_dossier_id_assurance_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."assurance_dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_items" ADD CONSTRAINT "assurance_dossier_items_task_validation_id_assurance_task_validations_id_fk" FOREIGN KEY ("task_validation_id") REFERENCES "public"."assurance_task_validations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_items" ADD CONSTRAINT "assurance_dossier_items_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_versions" ADD CONSTRAINT "assurance_dossier_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_versions" ADD CONSTRAINT "assurance_dossier_versions_dossier_id_assurance_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."assurance_dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_versions" ADD CONSTRAINT "assurance_dossier_versions_xml_asset_id_assets_id_fk" FOREIGN KEY ("xml_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_versions" ADD CONSTRAINT "assurance_dossier_versions_pdf_asset_id_assets_id_fk" FOREIGN KEY ("pdf_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_versions" ADD CONSTRAINT "assurance_dossier_versions_bundle_asset_id_assets_id_fk" FOREIGN KEY ("bundle_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossier_versions" ADD CONSTRAINT "assurance_dossier_versions_timestamp_receipt_asset_id_assets_id_fk" FOREIGN KEY ("timestamp_receipt_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossiers" ADD CONSTRAINT "assurance_dossiers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_dossiers" ADD CONSTRAINT "assurance_dossiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_jobs" ADD CONSTRAINT "assurance_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_run_records" ADD CONSTRAINT "assurance_run_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_run_records" ADD CONSTRAINT "assurance_run_records_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_run_records" ADD CONSTRAINT "assurance_run_records_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_task_validations" ADD CONSTRAINT "assurance_task_validations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_task_validations" ADD CONSTRAINT "assurance_task_validations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_task_validations" ADD CONSTRAINT "assurance_task_validations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_verification_events" ADD CONSTRAINT "assurance_verification_events_dossier_id_assurance_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."assurance_dossiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_verification_events" ADD CONSTRAINT "assurance_verification_events_dossier_version_id_assurance_dossier_versions_id_fk" FOREIGN KEY ("dossier_version_id") REFERENCES "public"."assurance_dossier_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_dossier_items_dossier_validation_uq" ON "assurance_dossier_items" USING btree ("dossier_id","task_validation_id");--> statement-breakpoint
CREATE INDEX "assurance_dossier_items_company_dossier_idx" ON "assurance_dossier_items" USING btree ("company_id","dossier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_dossier_versions_dossier_version_uq" ON "assurance_dossier_versions" USING btree ("dossier_id","version");--> statement-breakpoint
CREATE INDEX "assurance_dossier_versions_company_dossier_idx" ON "assurance_dossier_versions" USING btree ("company_id","dossier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_dossiers_public_id_uq" ON "assurance_dossiers" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "assurance_dossiers_company_status_idx" ON "assurance_dossiers" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "assurance_dossiers_project_idx" ON "assurance_dossiers" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_jobs_dedupe_uq" ON "assurance_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "assurance_jobs_ready_idx" ON "assurance_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "assurance_jobs_company_idx" ON "assurance_jobs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_run_records_run_digest_uq" ON "assurance_run_records" USING btree ("run_id","source_digest");--> statement-breakpoint
CREATE INDEX "assurance_run_records_company_run_idx" ON "assurance_run_records" USING btree ("company_id","run_id");--> statement-breakpoint
CREATE INDEX "assurance_run_records_issue_captured_idx" ON "assurance_run_records" USING btree ("issue_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_task_validations_issue_digest_uq" ON "assurance_task_validations" USING btree ("issue_id","input_digest");--> statement-breakpoint
CREATE INDEX "assurance_task_validations_company_state_idx" ON "assurance_task_validations" USING btree ("company_id","state");--> statement-breakpoint
CREATE INDEX "assurance_task_validations_issue_validated_idx" ON "assurance_task_validations" USING btree ("issue_id","validated_at");--> statement-breakpoint
CREATE INDEX "assurance_verification_events_dossier_verified_idx" ON "assurance_verification_events" USING btree ("dossier_id","verified_at");