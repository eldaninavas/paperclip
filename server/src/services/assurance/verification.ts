import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  assuranceDossiers,
  assuranceDossierVersions,
  assuranceVerificationEvents,
  companies,
  projects,
} from "@paperclipai/db";
import type { AssurancePublicVerificationDto } from "@paperclipai/shared";
import { assuranceSha256 } from "./hasher.js";

function securityHash(value: string | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export async function verifyPublicAssurance(input: {
  db: Db;
  publicId: string;
  method?: "public_id" | "qr" | "upload";
  suppliedManifest?: Record<string, unknown>;
  remoteAddress?: string;
  userAgent?: string;
}): Promise<AssurancePublicVerificationDto> {
  const row = await input.db.select({
    dossier: assuranceDossiers,
    version: assuranceDossierVersions,
    companyName: companies.name,
    projectName: projects.name,
  }).from(assuranceDossiers)
    .innerJoin(assuranceDossierVersions, and(
      eq(assuranceDossiers.id, assuranceDossierVersions.dossierId),
      eq(assuranceDossiers.companyId, assuranceDossierVersions.companyId),
    ))
    .innerJoin(companies, eq(assuranceDossiers.companyId, companies.id))
    .leftJoin(projects, eq(assuranceDossiers.projectId, projects.id))
    .where(eq(assuranceDossiers.publicId, input.publicId))
    .orderBy(desc(assuranceDossierVersions.version))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  const securityJson = {
    addressHash: securityHash(input.remoteAddress),
    userAgentHash: securityHash(input.userAgent),
  };
  if (!row) {
    await input.db.insert(assuranceVerificationEvents).values({
      result: "not_found",
      method: input.method ?? "public_id",
      securityJson,
    });
    return { found: false, integrity: "not_found" };
  }
  const storedHashValid = assuranceSha256(row.version.manifestJson) === row.version.manifestSha256;
  const suppliedHashValid = !input.suppliedManifest || assuranceSha256(input.suppliedManifest) === row.version.manifestSha256;
  const integrity = storedHashValid && suppliedHashValid ? "valid" : "altered";
  await input.db.insert(assuranceVerificationEvents).values({
    dossierId: row.dossier.id,
    dossierVersionId: row.version.id,
    result: row.dossier.status === "revoked" ? "revoked" : integrity,
    method: input.method ?? "public_id",
    securityJson,
  });
  const disclosure = row.dossier.disclosurePolicy;
  return {
    found: true,
    integrity,
    status: row.dossier.status === "revoked" ? "revoked" : row.dossier.status === "superseded" ? "superseded" : "current",
    publicId: row.dossier.publicId,
    title: disclosure.taskTitles === true ? row.dossier.title : "Foundation Assurance dossier",
    company: disclosure.companyIdentity === true ? row.companyName : undefined,
    project: disclosure.projectIdentity === true ? row.projectName ?? null : undefined,
    issuedAt: row.version.sealedAt.toISOString(),
    manifestSha256: row.version.manifestSha256,
    signatureStatus: row.version.signatureValue
      ? row.version.signingKeyId?.startsWith("local-dev") ? "local_dev" : "valid"
      : "not_configured",
    timestampStatus: row.version.timestampStatus as AssurancePublicVerificationDto["timestampStatus"],
  };
}
