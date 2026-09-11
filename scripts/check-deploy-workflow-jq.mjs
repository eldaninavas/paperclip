#!/usr/bin/env node
/**
 * Compile-check the jq programs embedded in the Foundation deploy workflow.
 *
 * The deploy rewrites the ECS task definition with a jq filter held in a bash
 * single-quoted string. An apostrophe anywhere inside it — including in a
 * comment — closes that string early and truncates the program, which fails the
 * deploy at the last step, after a full image build. That cost a real deploy
 * cycle once.
 *
 * This reads the filters out of the workflow file itself rather than a copy, so
 * it catches the quoting bug that a hand-retyped test cannot.
 *
 * Usage: node scripts/check-deploy-workflow-jq.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github/workflows/foundation-deploy.yml");
const workflow = await import("node:fs").then((fs) => fs.readFileSync(workflowPath, "utf8"));

// Every embedded filter, from `jq --arg` to the redirect that ends the command.
const filters = [...workflow.matchAll(/jq --arg image[\s\S]*?> next-task-definition\.json/g)].map(
  (match) => match[0],
);

if (filters.length === 0) {
  console.error("No jq filter found in the deploy workflow — did the step change shape?");
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "deploy-jq-"));
writeFileSync(
  path.join(workDir, "task-definition.json"),
  JSON.stringify({
    family: "foundation-check",
    taskDefinitionArn: "arn:aws:ecs:mx-central-1:0:task-definition/x:1",
    revision: 1,
    status: "ACTIVE",
    containerDefinitions: [
      {
        name: "foundation",
        image: "old",
        // A pre-existing variable the filter must preserve: dropping the
        // database URL would start the service with no database.
        environment: [{ name: "DATABASE_URL", value: "postgres://example" }],
      },
    ],
  }),
);

let failed = 0;
filters.forEach((filter, index) => {
  try {
    execFileSync("bash", ["-c", filter], {
      cwd: workDir,
      env: {
        ...process.env,
        IMAGE: "example-image",
        BEDROCK_MODEL: "global.anthropic.claude-sonnet-4-6",
        RUN_LOG_BUCKET: "example-bucket",
        START_COMMAND: "exec node server/dist/index.js",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const result = JSON.parse(
      execFileSync("cat", ["next-task-definition.json"], { cwd: workDir, encoding: "utf8" }),
    );
    const env = result.containerDefinitions[0].environment;
    const names = new Set(env.map((entry) => entry.name));
    const required = [
      "FOUNDATION_CLOUD_EXECUTION",
      "CLAUDE_CODE_USE_BEDROCK",
      "AWS_REGION",
      "ANTHROPIC_MODEL",
      "RUN_LOG_S3_BUCKET",
    ];
    const missing = required.filter((name) => !names.has(name));
    if (missing.length > 0) throw new Error(`missing variables: ${missing.join(", ")}`);
    if (!names.has("DATABASE_URL")) throw new Error("filter dropped DATABASE_URL");
    const duplicates = env.length !== names.size;
    if (duplicates) throw new Error("filter produced duplicate environment entries");
    console.log(`  OK    filter ${index + 1}: compiles, keeps DATABASE_URL, sets Foundation Cloud`);
  } catch (error) {
    failed += 1;
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    console.error(`  FAIL  filter ${index + 1}: ${detail}`);
  }
});

console.log(`\n${filters.length - failed}/${filters.length} jq filters valid`);
process.exit(failed === 0 ? 0 : 1);
