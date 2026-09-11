import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runLogRefBelongsToCompany } from "../services/run-log-store.ts";

describe("run log tenant ownership", () => {
  const tenant = randomUUID();
  const neighbour = randomUUID();

  it("accepts a reference written under the asking tenant", () => {
    const ref = `${tenant}/${randomUUID()}/${randomUUID()}.ndjson`;
    expect(runLogRefBelongsToCompany(ref, tenant)).toBe(true);
  });

  it("rejects a reference that points at another tenant", () => {
    const ref = `${neighbour}/${randomUUID()}/${randomUUID()}.ndjson`;
    expect(runLogRefBelongsToCompany(ref, tenant)).toBe(false);
  });

  it("rejects a traversal that would climb out of the tenant prefix", () => {
    expect(runLogRefBelongsToCompany(`../${neighbour}/a/b.ndjson`, tenant)).toBe(
      false,
    );
    expect(runLogRefBelongsToCompany(`/etc/passwd`, tenant)).toBe(false);
  });

  it("reads a Windows-style separator as a separator", () => {
    // A reference produced on a Windows host joins with a backslash; treating
    // that as an ordinary character would make the whole path one segment and
    // pass every cross-tenant reference through unchecked.
    expect(
      runLogRefBelongsToCompany(`${neighbour}\\agent\\run.ndjson`, tenant),
    ).toBe(false);
    expect(
      runLogRefBelongsToCompany(`${tenant}\\agent\\run.ndjson`, tenant),
    ).toBe(true);
  });

  it("leaves a pre-tenant flat reference readable", () => {
    // Older runs stored the file name alone. They belong to whoever the run
    // row says, and failing them closed would hide history without isolating
    // anything.
    expect(runLogRefBelongsToCompany("legacy-run.ndjson", tenant)).toBe(true);
  });
});
