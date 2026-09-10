# Foundation demo runbook

## Primary demo mode

The primary presentation is prompt-driven: the presenter gives Codex a normal
business request, Codex operates Foundation as the board interface, and the
Foundation agent produces the deliverable. Use the exact prompt and narration
in [FOUNDATION-LIVE-DEMO.md](./FOUNDATION-LIVE-DEMO.md).

The prepared NOV-1 walkthrough below is the deterministic fallback and the
post-run evidence tour. `foundation-demo.sh` is a backstage preflight/restore
aid; it is not the main product interaction shown to the audience.

## The claim

Foundation turns an executive request into governed work: a named agent produces a reviewable deliverable, the system records how it was produced, and a human can retain verifiable evidence of the outcome.

Do not present Foundation as a chatbot or as autonomous magic. The value is the controlled chain from intent to evidence.

## The scenario

Nova Finanzas wants to understand whether its Q3 cloud spend remained within a monthly budget of MXN 90,000.

The board provides three synthetic monthly figures and asks an evidence analyst to produce:

- a monthly variance table;
- quarterly totals and averages;
- an executive recommendation;
- a calculation checklist;
- a visible disclosure that the data is fictitious.

The agent produces `informe-ejecutivo-nova-finanzas.pdf`, a polished two-page executive report. Foundation retains the task, execution record, deliverable, cost and an immutable Assurance dossier.

## Ten minutes before the demo

From the repository root, run:

```bash
./scripts/foundation-demo.sh --prepare
```

This checks the server, task, dossier, verification route and new PDF renderer, then creates a database backup. It does not modify the demo records.

Open the four presentation stops:

```bash
./scripts/foundation-demo.sh --open
```

Close unrelated tabs and browser extensions that cover the page. Keep the zoom at 100%. Start on the Project tab.

## Starting from an entirely empty instance

Foundation can be returned to a real zero-tenant state with:

```bash
./scripts/foundation-reset-zero.sh --plan
./scripts/foundation-reset-zero.sh --execute
```

The execution requires typing `RESET default TO ZERO` exactly. It performs a logical backup, stops the current development service, moves the complete `default` instance into `~/.paperclip/reset-archives/`, boots a new embedded database and verifies that `/api/companies` returns an empty array.

This operation does not permanently delete the previous instance. The successful command prints the exact restore command and archive path.

Do not run the zero reset immediately before using the prepared Nova Finanzas walkthrough: the reset intentionally removes every tenant from the active database. Either demonstrate first-run onboarding from the empty instance or restore the archived state before running `foundation-demo.sh`.

### Three-run reset QA — 2026-09-09

The zero-reset flow was executed successfully three consecutive times after fixing embedded PostgreSQL shutdown:

| Run | Tenants before | Tenants after | Health | UI destination |
| --- | ---: | ---: | --- | --- |
| 1 | 3 | 0 | `ok` | `/onboarding` |
| 2 | 0 | 0 | `ok` | `/onboarding` |
| 3 | 0 | 0 | `ok` | `/onboarding` |

The active local instance is currently the empty instance from run 3. The original prepared demo state is preserved at:

```text
/Users/danielnavas/.paperclip/reset-archives/default-before-zero-20260909T075513Z
```

Restore it before presenting the prepared Nova Finanzas walkthrough:

```bash
./scripts/foundation-reset-zero.sh --restore /Users/danielnavas/.paperclip/reset-archives/default-before-zero-20260909T075513Z
```

## Seven-minute spoken script

### 0:00-0:40 - Frame the problem

Say:

> Companies do not need another place to chat with AI. They need a way to delegate work, receive an actual deliverable and know what happened without reading a terminal log. Foundation is the operating layer between the request, the agent and the human decision.

Show: `Nova Finanzas → Control de gastos Q3`.

Point out that the project contains one clearly scoped task. Do not open filters or configuration.

### 0:40-1:30 - Show the request

Open `NOV-1 — Emitir informe ejecutivo de variación presupuestaria`.

Say:

> This is a deliberately ordinary business request. The board provides the source figures, defines the deliverable and states exactly when the work is considered complete. The task is assigned to a named agent, not sent into an anonymous chat.

Show only the first occurrence of the task instructions. Do not expand “Show more”; the historical description contains duplicated source text.

### 1:30-3:20 - Show execution becoming a deliverable

Scroll to `Entrega completada`.

Say:

> Foundation separates operational activity from the outcome. Tool activity is collapsed. What the reviewer sees first is the final deliverable, the verified calculations and the recommendation.

Point out:

- `informe-ejecutivo-nova-finanzas.pdf` is the primary deliverable, not merely a chat response;
- the PDF opens as a real executive report with headline metrics, a comparison chart, the monthly variance table and a calculation-validation page;
- total spend: MXN 262,450;
- budget: MXN 270,000;
- favorable variance: MXN 7,550, or 2.80%;
- the recommendation to monitor monthly drivers and alert at 90% of budget;
- duration, seven tools, recorded cost of $0.00 and token consumption.

Say:

> Zero cost is shown explicitly. Foundation does not hide missing or zero values, and it keeps the economics attached to the work.

If useful, open the deliverable preview. Do not expand the first interrupted run unless someone asks about failure handling.

### 3:20-4:10 - Explain human control

Say:

> The agent can do the work, but it cannot silently turn its own output into an accepted business decision. The review boundary is human-only. Intermediate events do not need approval; the decision belongs to the finished deliverable.

Do not use Inbox as a primary stop in this build. Resolved Assurance approvals still expose internal fields in the detail panel. If asked, explain that the approval flow is being consolidated into Inbox and show it only as a secondary preview.

### 4:10-5:40 - Show Assurance

Switch to `Cierre Ejecutivo — Control de Gastos Q3`.

Say:

> Once the work is accepted, Foundation can close an evidence dossier. This version records the included task, exceptions, immutable version and the manifest fingerprint.

Point out:

- one included task;
- zero exceptions;
- status `Válido`;
- version 1;
- SHA-256 manifest digest;
- downloadable manifest, XML, visual PDF and complete bundle;
- QR/public verification route.

Open `report.pdf` only if there is enough time. The preflight has already verified that it uses the visual renderer.

### 5:40-6:30 - Verify independently

Switch to the public verification tab.

Say:

> The recipient does not need access to the internal workspace to check whether the dossier they received still matches the sealed manifest. The public route reports that the integrity is valid and that this is the current version.

Point out `Integridad válida`, the digest and `current` status.

Then say:

> This local demo intentionally has no external signing or timestamp provider configured. Foundation says so instead of fabricating trust. In production, those controls plug into the deployment's selected provider.

Do not claim legal certification, tax validation or proof that the underlying business statement is true. Assurance proves retained provenance and integrity.

### 6:30-7:00 - Close

Say:

> The product is not the answer in the chat. The product is this chain: scoped intent, accountable execution, a reviewable artifact, a human boundary and evidence that can be verified later. That is what makes agentic work usable inside a company.

Pause. Invite questions.

## Three-minute version

If time is cut:

1. Start directly on `NOV-1` at `Entrega completada`.
2. State the request and point to the file plus verified numbers.
3. Show the execution metrics.
4. Switch to the sealed dossier.
5. Finish on `Integridad válida` in public verification.

Use this closing line:

> Foundation converts agent activity into a governed deliverable that a human can understand, accept and verify.

## What not to do live

- Do not create a new agent.
- Do not run a heartbeat.
- Do not retry the historical interrupted run.
- Do not click `Validar ahora`, request a new approval or close another version.
- Do not change the task, project, status or assignee.
- Do not upload a file.
- Do not rely on a fresh provider execution during the main demonstration.
- Do not restore a database during the presentation.

The main route is intentionally read-only. A live model execution adds latency and adapter risk without strengthening the core product claim.

## Failure plan

### Foundation does not load

Run:

```bash
./scripts/foundation-demo.sh --check
```

If the health check fails, restart only the existing Foundation development service and run the check again. Do not change instances or initialize a new database.

### The task page fails

Move directly to the dossier tab and explain the completed work from the included-task row. Then show the visual PDF and public verification.

### The PDF opens an old design

Close the old file from Downloads and download `report.pdf` again. The endpoint is intentionally uncached and reconstructs legacy dossiers with the current visual renderer.

### Public verification is unavailable

Show the same SHA-256 digest in the dossier and PDF. State that the public verifier is a convenience surface over the retained manifest; do not pretend the live verification succeeded.

### Someone asks for a live run

Say:

> I can show a live run after the core walkthrough. The important product behavior is not token streaming; it is how Foundation turns that execution into controlled work and durable evidence.

Only run it after the seven-minute path is complete, and use a disposable QA task rather than `NOV-1`.

## Honest answers to predictable questions

### “Is this just another AI chat?”

No. Chat is one interaction surface. Foundation adds assignment, project context, execution records, files, cost, human review and verifiable evidence.

### “Does Assurance prove the answer is correct?”

It proves which evidence was retained, its provenance and whether the sealed manifest changed. It does not independently prove that every business claim is true.

### “Why does it say signature and timestamp are not configured?”

This is a local demo deployment. External trust providers are deliberately disabled. The product exposes that limitation instead of showing a false green check.

### “What happens when an agent fails?”

The run ends visibly, the technical detail remains available but collapsed, and the work can be retried or reassigned. The completed task already contains one historical interrupted run and one successful run.

### “Can this work for multiple customers?”

The control plane is organized by company, project, agent, permissions and isolated evidence scope. Production tenancy and credential isolation still require deployment-specific security validation.

## Current limitations to disclose only when relevant

- Resolved Assurance approvals in Inbox still expose low-level fields and may feel duplicated beside task activity.
- Some labels mix Spanish and English.
- The local environment has no production signing or timestamp provider.
- The demo proves the controlled workflow and evidence model; it is not a claim of regulatory certification.
