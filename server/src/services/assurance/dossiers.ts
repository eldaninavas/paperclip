import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvals,
  assets,
  assuranceDossierItems,
  assuranceDossiers,
  assuranceDossierVersions,
  assuranceTaskValidations,
  companies,
  issues,
  projects,
} from "@paperclipai/db";
import {
  ASSURANCE_MANIFEST_SCHEMA_VERSION,
  DEFAULT_ASSURANCE_DISCLOSURE_POLICY,
  type CreateAssuranceDossier,
  type UpdateAssuranceDossier,
} from "@paperclipai/shared";
import type { StorageService } from "../../storage/types.js";
import { canonicalizeAssuranceJson } from "./canonicalizer.js";
import { assuranceSha256 } from "./hasher.js";
import { buildAssuranceManifest } from "./manifest-builder.js";
import { renderAssurancePdf, renderAssuranceXml, renderAssuranceZip } from "./renderers.js";
import { renderAssuranceQrSvg } from "./qr.js";
import { resolveAssuranceSigner } from "./signer.js";
import { resolveAssuranceTimestampProvider } from "./timestamp-provider.js";

type Actor = { type: "user" | "agent" | "system"; id: string };

function publicId() {
  return randomBytes(24).toString("base64url");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function assuranceDossierService(db: Db, storage: StorageService) {
  async function getDossier(companyId: string, dossierId: string) {
    return db.select().from(assuranceDossiers).where(and(
      eq(assuranceDossiers.id, dossierId),
      eq(assuranceDossiers.companyId, companyId),
    )).limit(1).then((rows) => rows[0] ?? null);
  }

  async function presealDigest(companyId: string, dossierId: string) {
    const rows = await db.select({
      taskValidationId: assuranceDossierItems.taskValidationId,
      issueId: assuranceDossierItems.issueId,
      inclusionState: assuranceDossierItems.inclusionState,
      inputDigest: assuranceTaskValidations.inputDigest,
      state: assuranceTaskValidations.state,
    }).from(assuranceDossierItems).innerJoin(assuranceTaskValidations, and(
      eq(assuranceDossierItems.taskValidationId, assuranceTaskValidations.id),
      eq(assuranceDossierItems.companyId, assuranceTaskValidations.companyId),
    )).where(and(
      eq(assuranceDossierItems.companyId, companyId),
      eq(assuranceDossierItems.dossierId, dossierId),
    )).orderBy(asc(assuranceDossierItems.position));
    return assuranceSha256({
      schemaVersion: "foundation.assurance-preseal.v1",
      dossierId,
      items: rows,
    });
  }

  async function refresh(companyId: string, dossierId: string, explicitIssueIds?: string[]) {
    const dossier = await getDossier(companyId, dossierId);
    if (!dossier) throw new Error("assurance_dossier_not_found");
    if (["sealed", "superseded", "revoked"].includes(dossier.status)) throw new Error("assurance_dossier_immutable");
    const latestRows = await db.select().from(assuranceTaskValidations).where(and(
      eq(assuranceTaskValidations.companyId, companyId),
      ...(dossier.scopeType === "project" && dossier.projectId
        ? [eq(assuranceTaskValidations.projectId, dossier.projectId)]
        : []),
      ...(explicitIssueIds?.length ? [inArray(assuranceTaskValidations.issueId, explicitIssueIds)] : []),
    )).orderBy(desc(assuranceTaskValidations.validatedAt));
    const latestByIssue = new Map<string, typeof latestRows[number]>();
    for (const validation of latestRows) {
      if (!latestByIssue.has(validation.issueId) && validation.state !== "stale") latestByIssue.set(validation.issueId, validation);
    }
    const selected = [...latestByIssue.values()].filter((validation) => {
      if (dossier.scopeType !== "period") return true;
      const time = validation.validatedAt.getTime();
      return (!dossier.periodStart || time >= dossier.periodStart.getTime())
        && (!dossier.periodEnd || time <= dossier.periodEnd.getTime());
    });
    await db.transaction(async (tx) => {
      const current = await tx.select().from(assuranceDossierItems).where(and(
        eq(assuranceDossierItems.companyId, companyId),
        eq(assuranceDossierItems.dossierId, dossierId),
      ));
      const wanted = new Set(selected.map((row) => row.id));
      for (const item of current) {
        if (!wanted.has(item.taskValidationId)) await tx.delete(assuranceDossierItems).where(eq(assuranceDossierItems.id, item.id));
      }
      for (let position = 0; position < selected.length; position += 1) {
        const validation = selected[position]!;
        await tx.insert(assuranceDossierItems).values({
          companyId,
          dossierId,
          taskValidationId: validation.id,
          issueId: validation.issueId,
          inclusionState: validation.state === "valid" ? "included" : "exception",
          inclusionReason: dossier.scopeType === "custom" ? "manual_selection" : `scope:${dossier.scopeType}`,
          exceptionJson: validation.state === "valid" ? null : { validationState: validation.state },
          position,
        }).onConflictDoUpdate({
          target: [assuranceDossierItems.dossierId, assuranceDossierItems.taskValidationId],
          set: {
            inclusionState: validation.state === "valid" ? "included" : "exception",
            exceptionJson: validation.state === "valid" ? null : { validationState: validation.state },
            position,
            updatedAt: new Date(),
          },
        });
      }
      const nextStatus = selected.length > 0 && selected.every((row) => row.state === "valid") ? "ready" : "blocked";
      await tx.update(assuranceDossiers).set({ status: nextStatus, updatedAt: new Date() }).where(eq(assuranceDossiers.id, dossierId));
    });
    return detail(companyId, dossierId);
  }

  async function create(companyId: string, input: CreateAssuranceDossier, actor: Actor) {
    if (actor.type !== "user") throw new Error("assurance_human_required");
    if (input.projectId) {
      const found = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))).limit(1);
      if (!found.length) throw new Error("assurance_project_not_found");
    }
    const [row] = await db.insert(assuranceDossiers).values({
      publicId: publicId(),
      companyId,
      title: input.title,
      scopeType: input.scopeType,
      projectId: input.projectId ?? null,
      scopeRef: input.scopeRef ?? null,
      periodStart: input.periodStart ? new Date(input.periodStart) : null,
      periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
      disclosurePolicy: { ...(input.disclosurePolicy ?? DEFAULT_ASSURANCE_DISCLOSURE_POLICY) },
      createdByUserId: actor.id,
    }).returning();
    if (!row) throw new Error("assurance_dossier_not_persisted");
    return refresh(companyId, row.id, input.issueIds);
  }

  async function update(companyId: string, dossierId: string, input: UpdateAssuranceDossier) {
    const dossier = await getDossier(companyId, dossierId);
    if (!dossier) throw new Error("assurance_dossier_not_found");
    if (["sealed", "superseded", "revoked"].includes(dossier.status)) throw new Error("assurance_dossier_immutable");
    const [row] = await db.update(assuranceDossiers).set({
      ...input,
      periodStart: input.periodStart === undefined ? undefined : input.periodStart ? new Date(input.periodStart) : null,
      periodEnd: input.periodEnd === undefined ? undefined : input.periodEnd ? new Date(input.periodEnd) : null,
      updatedAt: new Date(),
    }).where(and(eq(assuranceDossiers.id, dossierId), eq(assuranceDossiers.companyId, companyId))).returning();
    return row ?? null;
  }

  async function list(companyId: string) {
    const rows = await db.select().from(assuranceDossiers).where(eq(assuranceDossiers.companyId, companyId)).orderBy(desc(assuranceDossiers.updatedAt));
    return Promise.all(rows.map(async (row) => {
      const items = await db.select({ inclusionState: assuranceDossierItems.inclusionState }).from(assuranceDossierItems).where(and(
        eq(assuranceDossierItems.companyId, companyId),
        eq(assuranceDossierItems.dossierId, row.id),
      ));
      const latestVersion = await db.select({ sealedAt: assuranceDossierVersions.sealedAt }).from(assuranceDossierVersions).where(and(
        eq(assuranceDossierVersions.companyId, companyId),
        eq(assuranceDossierVersions.dossierId, row.id),
      )).orderBy(desc(assuranceDossierVersions.version)).limit(1).then((values) => values[0] ?? null);
      return {
        ...row,
        taskCount: items.length,
        exceptionCount: items.filter((item) => item.inclusionState === "exception").length,
        sealedAt: latestVersion?.sealedAt ?? null,
      };
    }));
  }

  async function detail(companyId: string, dossierId: string) {
    const dossier = await getDossier(companyId, dossierId);
    if (!dossier) return null;
    const [itemRows, versions] = await Promise.all([
      db.select({
        item: assuranceDossierItems,
        validation: assuranceTaskValidations,
        issueTitle: issues.title,
      }).from(assuranceDossierItems).innerJoin(assuranceTaskValidations, and(
        eq(assuranceDossierItems.taskValidationId, assuranceTaskValidations.id),
        eq(assuranceDossierItems.companyId, assuranceTaskValidations.companyId),
      )).innerJoin(issues, and(
        eq(assuranceDossierItems.issueId, issues.id),
        eq(assuranceDossierItems.companyId, issues.companyId),
      )).where(and(
        eq(assuranceDossierItems.companyId, companyId),
        eq(assuranceDossierItems.dossierId, dossierId),
      )).orderBy(asc(assuranceDossierItems.position)),
      db.select().from(assuranceDossierVersions).where(and(
        eq(assuranceDossierVersions.companyId, companyId),
        eq(assuranceDossierVersions.dossierId, dossierId),
      )).orderBy(desc(assuranceDossierVersions.version)),
    ]);
    const inputDigest = await presealDigest(companyId, dossierId);
    return {
      ...dossier,
      inputDigest,
      taskCount: itemRows.length,
      exceptionCount: itemRows.filter(({ item }) => item.inclusionState === "exception").length,
      sealedAt: versions[0]?.sealedAt ?? null,
      items: itemRows.map(({ item, validation, issueTitle }) => ({
        ...item,
        issueTitle,
        validation: {
          ...validation,
          checks: Array.isArray(record(validation.checksJson).checks) ? record(validation.checksJson).checks : [],
          totals: validation.totalsJson,
          snapshot: validation.snapshotJson,
        },
      })),
      versions,
    };
  }

  async function requestApproval(companyId: string, dossierId: string, actor: Actor) {
    if (actor.type !== "user") throw new Error("assurance_human_required");
    const dossier = await getDossier(companyId, dossierId);
    if (!dossier) throw new Error("assurance_dossier_not_found");
    if (dossier.projectId) {
      const project = await db.select({ status: projects.status }).from(projects).where(and(
        eq(projects.companyId, companyId),
        eq(projects.id, dossier.projectId),
      )).limit(1).then((rows) => rows[0] ?? null);
      if (!project || project.status !== "completed") {
        throw new Error("assurance_dossier_not_ready:project_not_completed");
      }
    }
    const inputDigest = await presealDigest(companyId, dossierId);
    const existing = await db.select().from(approvals).where(and(
      eq(approvals.companyId, companyId),
      eq(approvals.type, "assurance_dossier_manifest"),
      sql`${approvals.payload} ->> 'dossierId' = ${dossierId}`,
      sql`${approvals.payload} ->> 'inputDigest' = ${inputDigest}`,
    )).orderBy(desc(approvals.createdAt)).limit(1).then((rows) => rows[0] ?? null);
    if (existing) return { approval: existing, inputDigest };
    const [approval] = await db.insert(approvals).values({
      companyId,
      type: "assurance_dossier_manifest",
      requestedByUserId: actor.id,
      status: "pending",
      payload: { dossierId, inputDigest, statement: "Approve closure of this exact Assurance dossier input." },
    }).returning();
    if (!approval) throw new Error("assurance_approval_not_persisted");
    return { approval, inputDigest };
  }

  async function storeAsset(companyId: string, userId: string, name: string, contentType: string, body: Buffer) {
    const stored = await storage.putFile({ companyId, namespace: "assurance", originalFilename: name, contentType, body });
    const [asset] = await db.insert(assets).values({
      companyId,
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByUserId: userId,
    }).returning();
    if (!asset) throw new Error("assurance_asset_not_persisted");
    return asset;
  }

  async function seal(companyId: string, dossierId: string, expectedInputDigest: string, actor: Actor, verificationBaseUrl: string) {
    if (actor.type !== "user") throw new Error("assurance_human_required");
    const dossier = await getDossier(companyId, dossierId);
    if (!dossier) throw new Error("assurance_dossier_not_found");
    if (["superseded", "revoked"].includes(dossier.status)) throw new Error("assurance_dossier_immutable");
    const currentDigest = await presealDigest(companyId, dossierId);
    if (currentDigest !== expectedInputDigest) throw new Error("assurance_input_digest_stale");
    const approval = await db.select().from(approvals).where(and(
      eq(approvals.companyId, companyId),
      eq(approvals.type, "assurance_dossier_manifest"),
      eq(approvals.status, "approved"),
      sql`${approvals.payload} ->> 'dossierId' = ${dossierId}`,
      sql`${approvals.payload} ->> 'inputDigest' = ${currentDigest}`,
    )).limit(1).then((rows) => rows[0] ?? null);
    if (!approval) throw new Error("assurance_dossier_approval_required");
    const details = await detail(companyId, dossierId);
    if (!details || details.items.length === 0 || details.items.some((item) => item.validation.state !== "valid")) {
      throw new Error("assurance_dossier_not_ready");
    }
    const previous = details.versions[0] ?? null;
    const version = (previous?.version ?? 0) + 1;
    const sealedAt = new Date();
    const built = buildAssuranceManifest({
      dossier,
      version,
      sealedAt,
      items: details.items.map((row) => ({
        issueId: row.issueId,
        taskValidationId: row.taskValidationId,
        inclusionReason: row.inclusionReason,
        validation: row.validation,
      })),
    });
    const signer = resolveAssuranceSigner();
    const signature = await signer.signDigest(built.manifestSha256);
    const timestampProvider = resolveAssuranceTimestampProvider();
    const timestamp = await timestampProvider.timestampDigest(built.manifestSha256);
    if (process.env.NODE_ENV === "production" && (!signature.productionTrusted || timestamp.status !== "valid")) {
      throw new Error("assurance_production_trust_provider_required");
    }
    const manifestBytes = Buffer.from(canonicalizeAssuranceJson(built.manifest), "utf8");
    const verificationUrl = `${verificationBaseUrl.replace(/\/$/, "")}/verify/${dossier.publicId}`;
    const qr = renderAssuranceQrSvg(verificationUrl);
    const xml = renderAssuranceXml(built.manifest, built.manifestSha256);
    const pdf = renderAssurancePdf({
      title: dossier.title,
      version,
      scopeLabel: dossier.scopeType,
      publicId: dossier.publicId,
      manifestSha256: built.manifestSha256,
      sealedAt: sealedAt.toISOString(),
      taskCount: details.items.length,
      totals: built.totals,
      tasks: details.items.map((item) => ({
        title: item.issueTitle,
        state: item.validation.state,
        runs: Number(record(item.validation.totalsJson).runs ?? 0),
        deliverables: Number(record(item.validation.totalsJson).deliverables ?? 0),
      })),
      verificationUrl,
      signatureLabel: signature.provider === "disabled" ? "not configured" : signature.productionTrusted ? "valid" : "local development only",
      timestampLabel: timestamp.status,
    });
    const signatureBytes = Buffer.from(canonicalizeAssuranceJson({ ...signature, manifestSha256: built.manifestSha256 }), "utf8");
    const files = [
      { name: "manifest.json", body: manifestBytes },
      { name: "evidence.xml", body: xml },
      { name: "report.pdf", body: pdf },
      { name: "signature.json", body: signatureBytes },
      { name: "verification-qr.svg", body: qr },
      ...(timestamp.receipt ? [{ name: "timestamp-receipt.tsr", body: timestamp.receipt }] : []),
    ];
    const bundle = renderAssuranceZip(files, sealedAt);
    const [xmlAsset, pdfAsset, bundleAsset, receiptAsset] = await Promise.all([
      storeAsset(companyId, actor.id, "evidence.xml", "application/xml", xml),
      storeAsset(companyId, actor.id, "report.pdf", "application/pdf", pdf),
      storeAsset(companyId, actor.id, "bundle.zip", "application/zip", bundle),
      timestamp.receipt ? storeAsset(companyId, actor.id, "timestamp-receipt.tsr", timestamp.contentType ?? "application/timestamp-reply", timestamp.receipt) : null,
    ]);
    const [row] = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`assurance:dossier:${companyId}:${dossierId}`}, 0))`);
      const currentVersion = await tx.select({ version: assuranceDossierVersions.version }).from(assuranceDossierVersions).where(and(
        eq(assuranceDossierVersions.companyId, companyId), eq(assuranceDossierVersions.dossierId, dossierId),
      )).orderBy(desc(assuranceDossierVersions.version)).limit(1).then((rows) => rows[0]?.version ?? 0);
      if (currentVersion >= version) throw new Error("assurance_seal_conflict");
      const inserted = await tx.insert(assuranceDossierVersions).values({
        companyId,
        dossierId,
        version,
        manifestSchemaVersion: ASSURANCE_MANIFEST_SCHEMA_VERSION,
        manifestJson: built.manifest,
        manifestSha256: built.manifestSha256,
        xmlAssetId: xmlAsset.id,
        pdfAssetId: pdfAsset.id,
        bundleAssetId: bundleAsset.id,
        signatureAlgorithm: signature.algorithm,
        signatureValue: signature.value,
        signingKeyId: signature.keyId,
        timestampProvider: timestamp.provider === "disabled" ? null : timestamp.provider,
        timestampStatus: timestamp.status,
        timestampReceiptAssetId: receiptAsset?.id ?? null,
        sealedByUserId: actor.id,
        sealedAt,
        supersedesVersionId: previous?.id ?? null,
      }).returning();
      await tx.update(assuranceDossiers).set({ status: "sealed", updatedAt: sealedAt }).where(eq(assuranceDossiers.id, dossierId));
      return inserted;
    });
    if (!row) throw new Error("assurance_version_not_persisted");
    return row;
  }

  async function overview(companyId: string) {
    const dossiers = await list(companyId);
    const validationRows = await db.select({
      issueId: assuranceTaskValidations.issueId,
      state: assuranceTaskValidations.state,
      title: issues.title,
    }).from(assuranceTaskValidations).innerJoin(issues, and(
      eq(assuranceTaskValidations.issueId, issues.id),
      eq(assuranceTaskValidations.companyId, issues.companyId),
    )).where(eq(assuranceTaskValidations.companyId, companyId))
      .orderBy(desc(assuranceTaskValidations.validatedAt));
    const latestByIssue = new Map<string, typeof validationRows[number]>();
    for (const validation of validationRows) {
      if (!latestByIssue.has(validation.issueId)) latestByIssue.set(validation.issueId, validation);
    }
    const exceptions = [...latestByIssue.values()]
      .filter((validation) => ["incomplete", "rejected", "stale"].includes(validation.state))
      .slice(0, 20);
    return {
      readyToSeal: dossiers.filter((row) => row.status === "ready").length,
      requiresAttention: dossiers.filter((row) => row.status === "blocked").length,
      drafts: dossiers.filter((row) => row.status === "draft").length,
      sealed: dossiers.filter((row) => row.status === "sealed").length,
      recentDossiers: dossiers.slice(0, 10),
      exceptions: exceptions.map((row) => ({ issueId: row.issueId, title: row.title, state: row.state, reason: `Validation ${row.state}` })),
    };
  }

  return { create, update, list, detail, refresh, requestApproval, seal, overview, presealDigest, getDossier };
}
