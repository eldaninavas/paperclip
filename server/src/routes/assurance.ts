import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  assets,
  assuranceDossiers,
  assuranceDossierVersions,
  assuranceTaskValidations,
  issues,
  projects,
} from "@paperclipai/db";
import {
  createAssuranceDossierSchema,
  sealAssuranceDossierSchema,
  updateAssuranceDossierSchema,
  verifyAssuranceUploadSchema,
} from "@paperclipai/shared";
import type { StorageService } from "../storage/types.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo, hasCompanyAccess } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { assuranceDossierService } from "../services/assurance/dossiers.js";
import { validateAssuranceTask } from "../services/assurance/task-validator.js";
import { verifyPublicAssurance } from "../services/assurance/verification.js";
import { canonicalizeAssuranceJson } from "../services/assurance/canonicalizer.js";
import { renderAssurancePdf } from "../services/assurance/renderers.js";
import { renderAssuranceQrSvg } from "../services/assurance/qr.js";

const PUBLIC_LIMIT_WINDOW_MS = 60_000;
const PUBLIC_LIMIT_MAX = 30;
const publicAttempts = new Map<string, { count: number; resetAt: number }>();

function validationDto(row: typeof assuranceTaskValidations.$inferSelect) {
  const checksJson = row.checksJson && typeof row.checksJson === "object" ? row.checksJson : {};
  return {
    ...row,
    checks: Array.isArray(checksJson.checks) ? checksJson.checks : [],
    totals: row.totalsJson,
    snapshot: row.snapshotJson,
  };
}

function rateLimitPublic(req: Request, res: Response) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = publicAttempts.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + PUBLIC_LIMIT_WINDOW_MS } : current;
  entry.count += 1;
  publicAttempts.set(key, entry);
  if (publicAttempts.size > 10_000) {
    for (const [candidate, value] of publicAttempts) if (value.resetAt <= now) publicAttempts.delete(candidate);
  }
  if (entry.count <= PUBLIC_LIMIT_MAX) return true;
  res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1_000)));
  res.status(429).json({ error: "Too many verification requests" });
  return false;
}

function actor(req: Request) {
  const info = getActorInfo(req);
  return {
    type: info.actorType === "user" ? "user" as const : info.actorType === "agent" ? "agent" as const : "system" as const,
    id: info.actorId,
    agentId: info.agentId,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assuranceError(res: Response, error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  if (code.endsWith("_not_found")) return res.status(404).json({ error: "Assurance resource not found" });
  if (code.includes("human_required")) return res.status(403).json({ error: "A human operator is required for this action" });
  if (code.includes("approval_required")) return res.status(409).json({ error: "Approval of the current Assurance digest is required" });
  if (code.includes("input_digest_stale") || code.includes("seal_conflict")) return res.status(409).json({ error: "Assurance inputs changed; refresh and approve the current version" });
  if (code.includes("immutable")) return res.status(409).json({ error: "Sealed Assurance versions are append-only" });
  if (code.includes("not_ready") || code.includes("not_terminal")) return res.status(422).json({ error: "Assurance evidence is not ready" });
  if (code.includes("production_trust_provider_required")) return res.status(422).json({ error: "A production signing and timestamp provider is required before sealing in production" });
  throw error;
}

export function assuranceRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const dossiers = assuranceDossierService(db, storage);

  async function accessibleDossier(req: Request, res: Response, dossierId: string) {
    const dossier = await db.select().from(assuranceDossiers).where(eq(assuranceDossiers.id, dossierId)).limit(1).then((rows) => rows[0] ?? null);
    if (!dossier || !hasCompanyAccess(req, dossier.companyId)) {
      res.status(404).json({ error: "Assurance dossier not found" });
      return null;
    }
    assertCompanyAccess(req, dossier.companyId);
    return dossier;
  }

  async function mutationActivity(req: Request, companyId: string, action: string, entityId: string, details?: Record<string, unknown>) {
    const info = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: info.actorType,
      actorId: info.actorId,
      agentId: info.agentId,
      runId: info.runId,
      action,
      entityType: "assurance_dossier",
      entityId,
      details,
    });
  }

  router.get("/companies/:companyId/assurance/overview", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await dossiers.overview(companyId));
  });

  router.get("/companies/:companyId/assurance/dossiers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await dossiers.list(companyId));
  });

  router.post("/companies/:companyId/assurance/dossiers", validate(createAssuranceDossierSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    try {
      const result = await dossiers.create(companyId, req.body, actor(req));
      await mutationActivity(req, companyId, "assurance.dossier_created", result!.id, { scopeType: result!.scopeType });
      res.status(201).json(result);
    } catch (error) { assuranceError(res, error); }
  });

  router.get("/projects/:projectId/assurance", async (req, res) => {
    const projectId = req.params.projectId as string;
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1).then((rows) => rows[0] ?? null);
    if (!project || !hasCompanyAccess(req, project.companyId)) return res.status(404).json({ error: "Project not found" });
    assertCompanyAccess(req, project.companyId);
    const validations = await db.select().from(assuranceTaskValidations).where(and(
      eq(assuranceTaskValidations.companyId, project.companyId),
      eq(assuranceTaskValidations.projectId, project.id),
    )).orderBy(desc(assuranceTaskValidations.validatedAt));
    const latest = new Map<string, typeof validations[number]>();
    for (const row of validations) if (!latest.has(row.issueId)) latest.set(row.issueId, row);
    const values = [...latest.values()];
    const dossierRows = (await dossiers.list(project.companyId)).filter((row) => row.projectId === project.id);
    res.json({
      project,
      coverage: {
        tasks: values.length,
        valid: values.filter((row) => row.state === "valid").length,
        incomplete: values.filter((row) => row.state !== "valid").length,
        runs: values.reduce((sum, row) => sum + Number(row.totalsJson.runs ?? 0), 0),
        inputTokens: values.reduce((sum, row) => sum + Number(row.totalsJson.inputTokens ?? 0), 0),
        outputTokens: values.reduce((sum, row) => sum + Number(row.totalsJson.outputTokens ?? 0), 0),
        costCents: values.reduce((sum, row) => sum + Number(row.totalsJson.costCents ?? 0), 0),
        deliverables: values.reduce((sum, row) => sum + Number(row.totalsJson.deliverables ?? 0), 0),
        approvals: values.reduce((sum, row) => sum + Number(row.totalsJson.approvals ?? 0), 0),
      },
      validations: values.map(validationDto),
      dossiers: dossierRows,
    });
  });

  router.post("/projects/:projectId/assurance/dossiers", validate(createAssuranceDossierSchema), async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1).then((rows) => rows[0] ?? null);
    if (!project || !hasCompanyAccess(req, project.companyId)) return res.status(404).json({ error: "Project not found" });
    assertCompanyAccess(req, project.companyId);
    try {
      const result = await dossiers.create(project.companyId, { ...req.body, scopeType: "project", projectId }, actor(req));
      await mutationActivity(req, project.companyId, "assurance.dossier_created", result!.id, { projectId });
      res.status(201).json(result);
    } catch (error) { assuranceError(res, error); }
  });

  router.get("/issues/:issueId/assurance", async (req, res) => {
    const issueId = req.params.issueId as string;
    const issue = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1).then((rows) => rows[0] ?? null);
    if (!issue || !hasCompanyAccess(req, issue.companyId)) return res.status(404).json({ error: "Task not found" });
    assertCompanyAccess(req, issue.companyId);
    const validations = await db.select().from(assuranceTaskValidations).where(and(
      eq(assuranceTaskValidations.companyId, issue.companyId),
      eq(assuranceTaskValidations.issueId, issue.id),
    )).orderBy(desc(assuranceTaskValidations.validatedAt));
    res.json({ issueId: issue.id, latestValidation: validations[0] ? validationDto(validations[0]) : null, revisions: validations.map(validationDto) });
  });

  router.post("/issues/:issueId/assurance/validate", async (req, res) => {
    const issueId = req.params.issueId as string;
    const issue = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1).then((rows) => rows[0] ?? null);
    if (!issue || !hasCompanyAccess(req, issue.companyId)) return res.status(404).json({ error: "Task not found" });
    assertCompanyAccess(req, issue.companyId);
    try {
      const validation = await validateAssuranceTask({ db, companyId: issue.companyId, issueId, actor: actor(req) });
      const info = getActorInfo(req);
      await logActivity(db, {
        companyId: issue.companyId,
        actorType: info.actorType,
        actorId: info.actorId,
        agentId: info.agentId,
        runId: info.runId,
        action: "assurance.task_validated",
        entityType: "issue",
        entityId: issue.id,
        details: { taskValidationId: validation.id, inputDigest: validation.inputDigest, state: validation.state },
      });
      res.status(201).json(validationDto(validation));
    } catch (error) { assuranceError(res, error); }
  });

  router.get("/assurance/dossiers/:dossierId", async (req, res) => {
    const dossier = await accessibleDossier(req, res, req.params.dossierId as string);
    if (!dossier) return;
    res.json(await dossiers.detail(dossier.companyId, dossier.id));
  });

  router.patch("/assurance/dossiers/:dossierId", validate(updateAssuranceDossierSchema), async (req, res) => {
    const dossier = await accessibleDossier(req, res, req.params.dossierId as string);
    if (!dossier) return;
    assertBoard(req);
    try {
      const result = await dossiers.update(dossier.companyId, dossier.id, req.body);
      await mutationActivity(req, dossier.companyId, "assurance.dossier_updated", dossier.id);
      res.json(result);
    } catch (error) { assuranceError(res, error); }
  });

  router.post("/assurance/dossiers/:dossierId/refresh", async (req, res) => {
    const dossier = await accessibleDossier(req, res, req.params.dossierId as string);
    if (!dossier) return;
    assertBoard(req);
    try {
      const result = await dossiers.refresh(dossier.companyId, dossier.id);
      await mutationActivity(req, dossier.companyId, "assurance.dossier_refreshed", dossier.id);
      res.json(result);
    } catch (error) { assuranceError(res, error); }
  });

  router.post("/assurance/dossiers/:dossierId/request-approval", async (req, res) => {
    const dossier = await accessibleDossier(req, res, req.params.dossierId as string);
    if (!dossier) return;
    assertBoard(req);
    try {
      const result = await dossiers.requestApproval(dossier.companyId, dossier.id, actor(req));
      await mutationActivity(req, dossier.companyId, "assurance.approval_requested", dossier.id, { approvalId: result.approval.id, inputDigest: result.inputDigest });
      res.status(201).json(result);
    } catch (error) { assuranceError(res, error); }
  });

  router.post("/assurance/dossiers/:dossierId/seal", validate(sealAssuranceDossierSchema), async (req, res) => {
    const dossier = await accessibleDossier(req, res, req.params.dossierId as string);
    if (!dossier) return;
    assertBoard(req);
    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0]?.trim();
    const forwardedHost = String(req.headers["x-forwarded-host"] ?? req.get("host") ?? "localhost").split(",")[0]?.trim();
    const baseUrl = process.env.PAPERCLIP_PUBLIC_URL || `${forwardedProto}://${forwardedHost}`;
    try {
      const version = await dossiers.seal(dossier.companyId, dossier.id, req.body.expectedInputDigest, actor(req), baseUrl);
      await mutationActivity(req, dossier.companyId, "assurance.dossier_sealed", dossier.id, { versionId: version.id, manifestSha256: version.manifestSha256 });
      res.status(201).json(version);
    } catch (error) { assuranceError(res, error); }
  });

  async function latestVersion(req: Request, res: Response) {
    const dossier = await accessibleDossier(req, res, req.params.dossierId as string);
    if (!dossier) return null;
    const version = await db.select().from(assuranceDossierVersions).where(and(
      eq(assuranceDossierVersions.companyId, dossier.companyId),
      eq(assuranceDossierVersions.dossierId, dossier.id),
    )).orderBy(desc(assuranceDossierVersions.version)).limit(1).then((rows) => rows[0] ?? null);
    if (!version) {
      res.status(404).json({ error: "No sealed Assurance version exists" });
      return null;
    }
    return { dossier, version };
  }

  router.get("/assurance/dossiers/:dossierId/manifest", async (req, res) => {
    const context = await latestVersion(req, res);
    if (!context) return;
    res.type("application/json").send(canonicalizeAssuranceJson(context.version.manifestJson));
  });

  async function sendVersionAsset(req: Request, res: Response, field: "xmlAssetId" | "pdfAssetId" | "bundleAssetId", downloadName: string) {
    const context = await latestVersion(req, res);
    if (!context) return;
    const { version } = context;
    const assetId = version[field];
    if (!assetId) return res.status(404).json({ error: "Assurance artifact not available" });
    const asset = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.companyId, version.companyId))).limit(1).then((rows) => rows[0] ?? null);
    if (!asset) return res.status(404).json({ error: "Assurance artifact not available" });
    const object = await storage.getObject(asset.companyId, asset.objectKey);
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Content-Length", String(asset.byteSize));
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    object.stream.pipe(res);
  }

  async function sendCurrentPdf(req: Request, res: Response) {
    const context = await latestVersion(req, res);
    if (!context) return;
    const { dossier, version } = context;
    const details = await dossiers.detail(dossier.companyId, dossier.id);
    if (!details) return res.status(404).json({ error: "Assurance dossier not found" });

    const manifest = record(version.manifestJson);
    const manifestDossier = record(manifest.dossier);
    const totals = record(manifest.totals);
    const taskValidations = Array.isArray(manifest.taskValidations)
      ? manifest.taskValidations.map(record)
      : [];
    const detailByIssue = new Map(details.items.map((item) => [item.issueId, item]));
    const discloseTaskTitles = record(manifestDossier.disclosurePolicy).taskTitles === true;
    const tasks = taskValidations.map((validation, index) => {
      const issueId = typeof validation.issueId === "string" ? validation.issueId : "";
      const item = detailByIssue.get(issueId);
      const itemTotals = record(item?.validation.totals);
      return {
        title: discloseTaskTitles && item?.issueTitle ? item.issueTitle : `Task ${index + 1}`,
        state: typeof validation.state === "string" ? validation.state : "unknown",
        runs: Number(itemTotals.runs ?? 0),
        deliverables: Number(itemTotals.deliverables ?? 0),
      };
    });

    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0]?.trim();
    const forwardedHost = String(req.headers["x-forwarded-host"] ?? req.get("host") ?? "localhost").split(",")[0]?.trim();
    const baseUrl = process.env.PAPERCLIP_PUBLIC_URL || `${forwardedProto}://${forwardedHost}`;
    const pdf = renderAssurancePdf({
      title: typeof manifestDossier.title === "string" ? manifestDossier.title : dossier.title,
      version: Number(manifest.version ?? version.version),
      scopeLabel: typeof manifestDossier.scopeType === "string" ? manifestDossier.scopeType : dossier.scopeType,
      publicId: typeof manifestDossier.publicId === "string" ? manifestDossier.publicId : dossier.publicId,
      manifestSha256: version.manifestSha256,
      sealedAt: typeof manifest.sealedAt === "string" ? manifest.sealedAt : version.sealedAt.toISOString(),
      taskCount: taskValidations.length,
      totals: {
        costCents: Number(totals.costCents ?? 0),
        inputTokens: Number(totals.inputTokens ?? 0),
        outputTokens: Number(totals.outputTokens ?? 0),
      },
      tasks,
      verificationUrl: `${baseUrl.replace(/\/$/, "")}/verify/${dossier.publicId}`,
      signatureLabel: version.signatureAlgorithm
        ? `${version.signatureAlgorithm}${version.signingKeyId ? ` / ${version.signingKeyId}` : ""}`
        : "not configured",
      timestampLabel: version.timestampStatus,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.byteLength));
    res.setHeader("Content-Disposition", 'attachment; filename="report.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  }

  router.get("/assurance/dossiers/:dossierId/manifest.xml", (req, res) => void sendVersionAsset(req, res, "xmlAssetId", "evidence.xml"));
  router.get("/assurance/dossiers/:dossierId/report.pdf", (req, res) => void sendCurrentPdf(req, res));
  router.get("/assurance/dossiers/:dossierId/bundle.zip", (req, res) => void sendVersionAsset(req, res, "bundleAssetId", "assurance-bundle.zip"));

  router.get("/public/assurance/verify/:publicId", async (req, res) => {
    if (!rateLimitPublic(req, res)) return;
    const result = await verifyPublicAssurance({
      db,
      publicId: req.params.publicId as string,
      method: req.query.method === "qr" ? "qr" : "public_id",
      remoteAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  });

  router.post("/public/assurance/verify", validate(verifyAssuranceUploadSchema), async (req, res) => {
    if (!rateLimitPublic(req, res)) return;
    const manifest = req.body.manifest as Record<string, unknown> | undefined;
    const manifestDossier = manifest?.dossier;
    const embeddedPublicId = manifestDossier && typeof manifestDossier === "object"
      ? (manifestDossier as Record<string, unknown>).publicId
      : undefined;
    const publicId = typeof req.body.publicId === "string"
      ? req.body.publicId
      : typeof embeddedPublicId === "string" ? embeddedPublicId : null;
    if (!publicId) return res.status(400).json({ error: "The manifest does not contain a publicId" });
    const result = await verifyPublicAssurance({
      db,
      publicId,
      method: "upload",
      suppliedManifest: manifest,
      remoteAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  });

  router.get("/public/assurance/qr/:publicId.svg", async (req, res) => {
    if (!rateLimitPublic(req, res)) return;
    const publicId = req.params.publicId as string;
    const exists = await db.select({ id: assuranceDossiers.id }).from(assuranceDossiers).where(eq(assuranceDossiers.publicId, publicId)).limit(1);
    if (!exists.length) return res.status(404).json({ error: "Assurance dossier not found" });
    const baseUrl = process.env.PAPERCLIP_PUBLIC_URL || `${req.protocol}://${req.get("host") ?? "localhost"}`;
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("image/svg+xml").send(renderAssuranceQrSvg(`${baseUrl.replace(/\/$/, "")}/verify/${publicId}`));
  });

  return router;
}
