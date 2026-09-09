import { describe, expect, it } from "vitest";
import { createAssuranceDossierSchema, sealAssuranceDossierSchema } from "./assurance.js";

describe("Assurance validators", () => {
  it("requires a project for project-scoped dossiers", () => {
    expect(createAssuranceDossierSchema.safeParse({ title: "Audit", scopeType: "project" }).success).toBe(false);
  });

  it("accepts an exact SHA-256 digest for sealing", () => {
    expect(sealAssuranceDossierSchema.safeParse({ expectedInputDigest: "a".repeat(64) }).success).toBe(true);
    expect(sealAssuranceDossierSchema.safeParse({ expectedInputDigest: "stale" }).success).toBe(false);
  });
});
