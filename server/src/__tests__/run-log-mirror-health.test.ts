import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDurableRunLogStore,
  runLogMirrorHealth,
} from "../services/run-log-store.ts";

function objectStorage(behaviour: { fail?: Error } = {}) {
  return {
    async putObject(input: { body?: unknown }) {
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
      return { exists: false };
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
});