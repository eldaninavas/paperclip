import { describe, expect, it } from "vitest";
import { canonicalizeAssuranceJson } from "./canonicalizer.js";
import { assuranceSha256 } from "./hasher.js";
import { renderAssuranceQrSvg } from "./qr.js";
import { renderAssurancePdf, renderAssuranceXml, renderAssuranceZip } from "./renderers.js";

describe("Assurance artifacts", () => {
  it("canonicalizes and hashes independent of key insertion order", () => {
    const left = { z: 1, nested: { b: true, a: "value" } };
    const right = { nested: { a: "value", b: true }, z: 1 };
    expect(canonicalizeAssuranceJson(left)).toBe(canonicalizeAssuranceJson(right));
    expect(assuranceSha256(left)).toBe(assuranceSha256(right));
    expect(assuranceSha256(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("renders portable PDF, XML, ZIP and QR artifacts", () => {
    const manifest = { schemaVersion: "foundation.assurance-manifest.v1", title: "Evidence" };
    const digest = assuranceSha256(manifest);
    const xml = renderAssuranceXml(manifest, digest);
    const pdf = renderAssurancePdf({
      title: "Evidence",
      version: 2,
      scopeLabel: "project",
      publicId: "public-test-id",
      manifestSha256: digest,
      sealedAt: "2026-09-08T00:00:00.000Z",
      taskCount: 1,
      totals: { costCents: 12, inputTokens: 30, outputTokens: 10 },
      tasks: [{ title: "Verified task", state: "valid", runs: 2, deliverables: 1 }],
      verificationUrl: "https://foundation.example/verify/public-test-id",
      signatureLabel: "not configured",
      timestampLabel: "not_configured",
    });
    const qr = renderAssuranceQrSvg("https://foundation.example/verify/public-test-id");
    const zip = renderAssuranceZip([{ name: "manifest.json", body: Buffer.from(canonicalizeAssuranceJson(manifest)) }], new Date("2026-09-08T00:00:00Z"));
    expect(xml.toString()).toContain(`<manifestSha256>${digest}</manifestSha256>`);
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("EXECUTIVE SUMMARY");
    expect(pdf.toString("latin1")).toContain("Verified task");
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(qr.toString()).toContain("<svg");
    expect(qr.toString()).toContain("viewBox=\"0 0 45 45\"");
  });

  it("rejects a verification URL that exceeds the fixed QR capacity", () => {
    expect(() => renderAssuranceQrSvg(`https://example.test/${"x".repeat(120)}`)).toThrow("assurance_verification_url_too_long");
  });
});
