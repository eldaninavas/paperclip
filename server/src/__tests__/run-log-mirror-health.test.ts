import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginRunLogMirrorProbe,
  createDurableRunLogStore,
  probeRunLogMirror,
  runLogMirrorHealth,
} from "../services/run-log-store.ts";

function objectStorage(
  behaviour: { fail?: Error; failPut?: Error; failHead?: Error } = {},
) {
  const calls: string[] = [];
  return {
    calls,
    async putObject(input: { body?: unknown }) {
      calls.push("put");
      if (behaviour.failPut) throw behaviour.failPut;
      // Drain the body the way a real client would. Left unread, the lazily
      // opened file stream outlives the test and reports ENOENT once the
      // temporary directory is gone.
      const body = input?.body;
      if (body instanceof Readable) {
        await new Promise<void>((resolve, reject) => {
          body.on("data", () => undefined);
          body.on("end", () => resolve());
          body.on("error", () => resolve());
          body.on("close", () => resolve());
          setTimeout(reject, 5_000).unref?.();
        });
      }
      if (behaviour.fail) throw behaviour.fail;
    },
    async headObject() {
      calls.push("head");
      if (behaviour.failHead) throw behaviour.failHead;
      return { exists: false };
    },
    async deleteObject() {
      calls.push("delete");
    },
    async getObject() {
      return { stream: Readable.from([]) };
    },
  };
}

const roots: string[] = [];
function storeWith(provider: ReturnType<typeof objectStorage>) {
  const basePath = mkdtempSync(path.join(tmpdir(), "run-log-mirror-"));
  roots.push(basePath);
  return createDurableRunLogStore({
    basePath,
    s3: { provider: provider as never, keyPrefix: "run-logs" },
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("run log mirror health", () => {
  async function finalizeOneRun(store: ReturnType<typeof storeWith>) {
    const handle = await store.begin({
      companyId: "11111111-1111-4111-8111-111111111111",
      agentId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
    });
    await store.append(handle, {
      ts: new Date().toISOString(),
      stream: "stdout",
      chunk: "hello\n",
    });
    return store.finalize(handle);
  }

  it("counts a successful mirror", async () => {
    const store = storeWith(objectStorage());
    const before = runLogMirrorHealth().uploads;

    await finalizeOneRun(store);

    const health = runLogMirrorHealth();
    expect(health.configured).toBe(true);
    expect(health.uploads).toBeGreaterThan(before);
    expect(health.consecutiveFailures).toBe(0);
  });

  it("records a failed mirror without failing the run", async () => {
    // This is the case the counters exist for: finalization succeeds, the run
    // is billed, and the tenant's output only exists on a disk that the next
    // deploy throws away.
    const denied = new Error("Access Denied");
    denied.name = "AccessDenied";
    const store = storeWith(objectStorage({ fail: denied }));

    const summary = await finalizeOneRun(store);
    expect(summary.bytes).toBeGreaterThan(0);

    const health = runLogMirrorHealth();
    expect(health.consecutiveFailures).toBeGreaterThan(0);
    expect(health.lastFailureReason).toContain("AccessDenied");
    expect(health.lastFailureAt).not.toBeNull();
  });

  it("keeps object keys out of the reported reason", async () => {
    // The key is <prefix>/<companyId>/<agentId>/<runId>.ndjson, and this is
    // read by anything that can reach the health endpoint.
    const store = storeWith(
      objectStorage({ fail: new Error("failed on 11111111-1111-4111-8111-111111111111") }),
    );

    await finalizeOneRun(store);

    expect(runLogMirrorHealth().lastFailureReason).not.toContain("run-logs/");
  });

  it("reports configured from the environment before any run has happened", () => {
    // A health check that runs before the first agent run must not describe a
    // correctly configured deployment the same way it describes a broken one.
    const previous = process.env.RUN_LOG_S3_BUCKET;
    try {
      delete process.env.RUN_LOG_S3_BUCKET;
      const bare = runLogMirrorHealth();
      process.env.RUN_LOG_S3_BUCKET = "paperclip-run-logs";
      expect(runLogMirrorHealth().configured).toBe(true);
      expect(bare.uploads).toBe(runLogMirrorHealth().uploads);
    } finally {
      if (previous === undefined) delete process.env.RUN_LOG_S3_BUCKET;
      else process.env.RUN_LOG_S3_BUCKET = previous;
    }
  });

  it("does not probe object storage when none is configured", () => {
    const previous = process.env.RUN_LOG_S3_BUCKET;
    try {
      delete process.env.RUN_LOG_S3_BUCKET;
      beginRunLogMirrorProbe();
      // No bucket, no probe, and no claim either way about reachability.
      expect(runLogMirrorHealth().reachable).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.RUN_LOG_S3_BUCKET;
      else process.env.RUN_LOG_S3_BUCKET = previous;
    }
  });
});
describe("object storage probe", () => {
  it("reads, writes and cleans up when the bucket policy allows all three", async () => {
    const provider = objectStorage();
    await probeRunLogMirror({ provider: provider as never, keyPrefix: "run-logs" });

    expect(runLogMirrorHealth().reachable).toBe(true);
    expect(runLogMirrorHealth().writable).toBe(true);
    // The sentinel must not be left behind in a tenant output bucket.
    expect(provider.calls).toEqual(["head", "put", "delete"]);
  });

  it("names a bucket that reads but refuses writes", async () => {
    // The exact shape of a policy granting GetObject and not PutObject: the
    // container looks healthy right up until a tenant's first run.
    const denied = new Error("Access Denied");
    denied.name = "AccessDenied";
    const provider = objectStorage({ failPut: denied });

    await probeRunLogMirror({ provider: provider as never, keyPrefix: "run-logs" });

    expect(runLogMirrorHealth().reachable).toBe(true);
    expect(runLogMirrorHealth().writable).toBe(false);
    expect(runLogMirrorHealth().unwritableReason).toContain("AccessDenied");
    expect(provider.calls).toEqual(["head", "put"]);
  });

  it("does not attempt a write when the read already failed", async () => {
    // One missing credential explains both, and a second failure would only
    // repeat the first with a less useful message.
    const provider = objectStorage({ failHead: new Error("CredentialsNotLoaded") });

    await probeRunLogMirror({ provider: provider as never, keyPrefix: "run-logs" });

    expect(runLogMirrorHealth().reachable).toBe(false);
    expect(provider.calls).toEqual(["head"]);
  });

  it("keeps the sentinel under the run-log prefix and out of tenant namespaces", async () => {
    const keys: string[] = [];
    const provider = {
      async headObject(input: { objectKey: string }) {
        keys.push(input.objectKey);
        return { exists: false };
      },
      async putObject(input: { objectKey: string }) {
        keys.push(input.objectKey);
      },
      async deleteObject(input: { objectKey: string }) {
        keys.push(input.objectKey);
      },
    };

    await probeRunLogMirror({ provider: provider as never, keyPrefix: "run-logs" });

    // Same prefix as real objects so the same grant covers it, and dot-prefixed
    // so it can never collide with a company id.
    expect(new Set(keys)).toEqual(new Set(["run-logs/.foundation-mirror-probe"]));
  });
});
