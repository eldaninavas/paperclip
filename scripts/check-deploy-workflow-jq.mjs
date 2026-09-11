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

// GitHub Actions workflows are YAML, but this repo has no YAML dependency in
// scripts/, and the jq extraction above deliberately reads the raw text so it
// sees the exact bytes bash will. Jobs are pulled out with a small reader
// rather than adding a parser for one check.
const YAML_JOBS = readJobs(workflow);

function readJobs(source) {
  const jobs = {};
  const jobsIndex = source.indexOf("\njobs:");
  if (jobsIndex === -1) return jobs;
  const body = source.slice(jobsIndex + 1);
  let currentJob = null;
  let currentStep = null;
  let runIndent = null;
  for (const line of body.split("\n")) {
    const job = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) {
      currentJob = job[1];
      jobs[currentJob] = { steps: [] };
      currentStep = null;
      runIndent = null;
      continue;
    }
    if (!currentJob) continue;
    const stepStart = /^\s{6}- (?:name: (.*))?$/.exec(line);
    if (stepStart) {
      currentStep = { name: stepStart[1]?.trim(), run: null };
      jobs[currentJob].steps.push(currentStep);
      runIndent = null;
      continue;
    }
    const named = /^\s{8}name: (.*)$/.exec(line);
    if (named && currentStep && !currentStep.name) {
      currentStep.name = named[1].trim();
      continue;
    }
    if (runIndent !== null) {
      if (line.trim() === "") {
        currentStep.run += "\n";
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent >= runIndent) {
        currentStep.run += `${line.slice(runIndent)}\n`;
        continue;
      }
      runIndent = null;
    }
    const runStart = /^(\s{8})run: \|\s*$/.exec(line);
    if (runStart && currentStep) {
      currentStep.run = "";
      runIndent = runStart[1].length + 2;
      continue;
    }
    const runInline = /^\s{8}run: (.+)$/.exec(line);
    if (runInline && currentStep) currentStep.run = runInline[1];
  }
  for (const job of Object.values(jobs)) {
    job.steps = job.steps.filter((step) => typeof step.run === "string");
  }
  return jobs;
}

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

// Every `run:` block, parsed as shell.
//
// The jq check above exists because an apostrophe inside a filter once broke a
// deploy at the last step, after a full image build. The same class of mistake
// lives in any shell this workflow runs -- an unclosed quote, a `for` without
// its `done` -- and costs the same twenty minutes to discover. `bash -n` parses
// without executing, so it catches those without needing AWS or a runner.
const steps = [];
for (const [jobName, job] of Object.entries(YAML_JOBS)) {
  for (const step of job.steps ?? []) {
    if (typeof step.run === "string") {
      steps.push({ label: `${jobName} / ${step.name ?? "(unnamed)"}`, run: step.run });
    }
  }
}

let shellFailed = 0;
for (const step of steps) {
  const scriptPath = path.join(workDir, "step.sh");
  writeFileSync(scriptPath, step.run);
  try {
    execFileSync("bash", ["-n", scriptPath], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    shellFailed += 1;
    console.error(`  FAIL  ${step.label}: ${String(error.stderr ?? error.message).trim()}`);
  }
}
console.log(`${steps.length - shellFailed}/${steps.length} run blocks parse as shell`);

process.exit(failed === 0 && shellFailed === 0 ? 0 : 1);
