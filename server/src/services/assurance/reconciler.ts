import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assuranceJobs } from "@paperclipai/db";
import { reconcileAssuranceRunRecord } from "./run-recorder.js";
import { validateAssuranceTask } from "./task-validator.js";

const MAX_ATTEMPTS = 8;

export async function enqueueAssuranceJob(input: {
  db: Db;
  companyId: string;
  kind: "run_record" | "task_validate";
  dedupeKey: string;
  payload: Record<string, unknown>;
}) {
  const [row] = await input.db.insert(assuranceJobs).values({
    companyId: input.companyId,
    kind: input.kind,
    dedupeKey: input.dedupeKey,
    payloadJson: input.payload,
  }).onConflictDoNothing({ target: assuranceJobs.dedupeKey }).returning();
  return row ?? null;
}

function text(value: unknown, key: string) {
  const found = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
  if (typeof found !== "string") throw new Error(`assurance_job_${key}_missing`);
  return found;
}

export function createAssuranceReconciler(db: Db) {
  const workerId = `assurance-${process.pid}`;
  let draining = false;

  async function processOne() {
    const job = await db.transaction(async (tx) => {
      const candidate = await tx.select().from(assuranceJobs).where(and(
        inArray(assuranceJobs.status, ["pending", "failed"]),
        lte(assuranceJobs.availableAt, new Date()),
      )).orderBy(asc(assuranceJobs.availableAt)).for("update", { skipLocked: true }).limit(1).then((rows) => rows[0] ?? null);
      if (!candidate) return null;
      const [claimed] = await tx.update(assuranceJobs).set({
        status: "processing",
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: candidate.attempts + 1,
        updatedAt: new Date(),
      }).where(eq(assuranceJobs.id, candidate.id)).returning();
      return claimed ?? null;
    });
    if (!job) return false;
    try {
      if (job.kind === "run_record") {
        await reconcileAssuranceRunRecord({ db, companyId: job.companyId, runId: text(job.payloadJson, "runId") });
      } else if (job.kind === "task_validate") {
        await validateAssuranceTask({
          db,
          companyId: job.companyId,
          issueId: text(job.payloadJson, "issueId"),
          actor: { type: "system", id: "assurance-reconciler" },
        });
      } else {
        throw new Error(`assurance_job_kind_unsupported:${job.kind}`);
      }
      await db.update(assuranceJobs).set({
        status: "completed",
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(assuranceJobs.id, job.id));
    } catch (error) {
      const delay = Math.min(60 * 60_000, 2 ** Math.min(job.attempts, 10) * 1_000);
      await db.update(assuranceJobs).set({
        status: job.attempts >= MAX_ATTEMPTS ? "dead" : "failed",
        availableAt: new Date(Date.now() + delay),
        lockedAt: null,
        lockedBy: null,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        updatedAt: new Date(),
      }).where(eq(assuranceJobs.id, job.id));
    }
    return true;
  }

  async function drain(limit = 25) {
    if (draining) return;
    draining = true;
    try {
      for (let count = 0; count < limit && await processOne(); count += 1) {
        // bounded startup/trigger drain
      }
    } finally {
      draining = false;
    }
  }
  return { drain, processOne };
}

const reconcilers = new WeakMap<Db, ReturnType<typeof createAssuranceReconciler>>();

export function startAssuranceReconciler(db: Db) {
  const existing = reconcilers.get(db);
  if (existing) return existing;
  const reconciler = createAssuranceReconciler(db);
  reconcilers.set(db, reconciler);
  void reconciler.drain();
  const timer = setInterval(() => void reconciler.drain(), 15_000);
  timer.unref();
  return reconciler;
}

export async function signalAssuranceJob(input: Parameters<typeof enqueueAssuranceJob>[0]) {
  // The app-owned worker polls this durable queue. Keeping signal side-effect free
  // avoids spawning worker timers in service consumers and test processes.
  return enqueueAssuranceJob(input);
}
