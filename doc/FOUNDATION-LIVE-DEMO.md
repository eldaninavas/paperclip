# Foundation live demo — Codex as the board interface

## What the audience should see

The public demonstration starts in Codex with Foundation open in the visible
browser. It does not use a terminal, hidden API calls, or a pre-populated
Foundation screen. The presenter describes a normal business request. Codex
takes control of the browser, completes onboarding through the UI, creates and
assigns the work, waits for the agent to finish, and returns to the visible UI
to inspect and approve the PDF deliverable. Codex then marks the task `Done`
and the project `Completed`. The presenter creates the Assurance evidence
manually as the next visible step.

The preparation and restore commands are backstage safety controls. They are
not the product demonstration.

## Prompt to paste into Codex

Paste this from a Codex task that has browser-control access, with Foundation
open at `http://127.0.0.1:3100/onboarding`:

> Soy Nova Finanzas. Necesito comprobar si nuestro gasto de nube del tercer
> trimestre se mantuvo dentro de un presupuesto mensual de MXN 90,000. Los
> datos, todos ficticios, son: julio MXN 82,400; agosto MXN 91,750; septiembre
> MXN 88,300. Te autorizo a resolver la única decisión humana final de este
> ejercicio, pero solamente después de abrir y verificar el entregable.
>
> Toma control únicamente de la pestaña visible donde está abierto Foundation
> en `http://127.0.0.1:3100`. Antes de hacer clic, navega explícitamente esa
> misma pestaña a `http://127.0.0.1:3100/onboarding` y espera a que termine de
> cargar. No confíes en el contenido que ya estuviera visible: puede pertenecer
> a una sesión anterior. Confirma visualmente que aparece el onboarding vacío y
> que no hay una empresa seleccionada. Si aparece una empresa, un proyecto o un
> error, recarga una sola vez; si persiste, detente.
>
> La instancia está vacía: completa el onboarding desde cero a través de la UI.
> No abras Finder ni ninguna otra aplicación o
> pestaña. No busques, leas ni inspecciones archivos de mi computadora. No uses
> rutas locales, terminal, CLI ni llamadas directas a la API. Si algo no puede
> completarse dentro de la interfaz de Foundation, detente y dímelo.
>
> Crea la empresa **Nova Finanzas**, el proyecto **Control de gastos Q3** y un
> agente llamado **Analista de Evidencia** usando el adaptador local de Codex.
> Cuando Foundation solicite las instrucciones del agente, escribe directamente
> estas reglas en el campo de la interfaz: el agente es un analista financiero,
> ejecuta personalmente la tarea asignada, no contrata ni delega, verifica cada
> cálculo, genera un PDF real, lo registra como entregable principal y solicita
> como máximo una revisión humana solamente cuando el entregable esté terminado.
>
> Haz todas las modificaciones mediante esa única pestaña de Foundation. No
> prepares tú el entregable y no contrates otros agentes. Registra y asigna una
> tarea nueva para producir un informe
> ejecutivo real en PDF que incluya: tabla mensual contra presupuesto, total y
> promedio trimestral, variación absoluta y porcentual, una gráfica
> comparativa, recomendación ejecutiva, checklist de validación independiente y
> una nota visible indicando que los datos son ficticios.
>
> El PDF generado no es el final de tu parte del flujo. Cuando el agente
> termine, completa también el cierre de la tarea y del proyecto desde la
> interfaz, en este orden:
>
> 1. Abre el entregable principal y comprueba visualmente que es un PDF real,
>    que contiene la tabla, la gráfica, la recomendación, el checklist, la nota
>    de datos ficticios y estos valores: total MXN 262,450; presupuesto
>    trimestral MXN 270,000; variación favorable MXN 7,550 (2.80%); promedio
>    mensual MXN 87,483.33; agosto MXN 1,750 sobre presupuesto.
> 2. Si la tarea queda en **In review**, **Needs approval** o aparece una
>    solicitud final de decisión humana, usa la autorización explícita de este
>    mensaje para aprobar únicamente ese entregable final después de verificarlo.
>    No apruebes eventos intermedios ni solicitudes que no correspondan al PDF.
>    Si el contenido no cumple, pide cambios y reporta la prueba como incompleta.
> 3. Confirma que la tarea **Informe ejecutivo de gastos Q3** quede en
>    **Done**. Después cambia el proyecto **Control de gastos Q3** a
>    **Completed** (el estado final equivalente a Done para proyectos). Abre
>    nuevamente el proyecto y confirma visualmente ese estado después de
>    recargar la página.
>
> Detente al completar el paso 3. **No entres en Assurance y no crees ningún
> dossier:** esa parte la haré yo manualmente durante la demostración.
>
> Considera terminada tu parte solamente si los tres pasos anteriores quedan
> visibles y confirmados tras recargar la vista. Supervisa la ejecución sin
> editar ni fabricar el resultado por tu cuenta. **No existe un tiempo límite
> para esta ejecución.** Mientras el estado siga en **In Progress** o
> **Working**, continúa esperando y comprobando periódicamente la misma tarea
> dentro de Foundation, aunque tarde 5, 10, 20 minutos o más. No finalices tu
> respuesta, no declares la prueba incompleta, no pulses reintentar y no cambies
> de tarea mientras haya una ejecución viva. Debes permanecer en el ejercicio
> **hasta que termine**.
>
> Al finalizar, dame un resumen breve con los valores verificados, el estado
> final de la tarea, el estado final del proyecto (**Completed**) y enlaces de
> Foundation a la tarea, al PDF ejecutivo y al proyecto. Termina indicando:
> **"Listo para que el usuario cree el dossier en Assurance."** Si algo falla, no puede hacerse
> en la UI o permanece pendiente después de una recarga, detente y enumera
> exactamente cuál de los tres pasos quedó incompleto; no simules éxito.
> No ejecutes scripts de respaldo, no busques archivos locales y no intentes
> abrir una demostración preparada: todo el ejercicio debe completarse dentro
> de la pestaña visible de Foundation.

## What Codex should do

1. Attach to the visible Foundation browser tab and confirm the onboarding UI.
2. Create Nova Finanzas, the project and Analista de Evidencia through the UI.
3. Create one new task containing the exact figures and acceptance criteria.
4. Start or wake the agent from the UI and monitor the task until it reaches a
   terminal or human-attention state.
5. Inspect the primary PDF and verify all six invariant calculations.
6. Resolve only the final deliverable review, then verify the task is `done`.
7. Move the project to `completed` (projects use `completed`, not `done`).
8. Reload the task and project views, report the result only when both closure
   conditions remain satisfied, and stop before Assurance.

Codex is visibly operating the board interface. The Foundation agent is the
worker. This separation is the point of the demo.

## Hard pass/fail gate for the live run

The run passes only when all of these are simultaneously true after a page
reload:

- the business task is `Done`;
- no final deliverable decision remains pending;
- the project is `Completed`;
- the executive PDF opens from the task as its primary deliverable.

Anything less is an incomplete run. A conversational answer, a locally created
file, an unreviewed PDF or a project left `Planned`/`In Progress` does not
satisfy Codex's portion of the demo. Creating and sealing the Assurance dossier
is the presenter's next manual step.

## Presenter narration

Before sending the prompt, say:

> I am not opening a specialized workflow or filling out a configuration form.
> I am describing an ordinary business outcome to Codex. Codex will use
> Foundation as the operating layer, assign accountable work, and bring the
> result back with evidence.

While it runs, open Foundation and point out the newly created task, named
assignee, live status, and collapsed technical activity. Do not narrate every
tool call.

When Codex returns, open the PDF from the task and verify these invariant
figures:

- total spend: MXN 262,450;
- quarterly budget: MXN 270,000;
- favorable variance: MXN 7,550;
- favorable variance: 2.80%;
- monthly average: MXN 87,483.33;
- August exceeded its monthly budget by MXN 1,750.

Close with:

> The value is not that an AI can add three numbers. The value is that a plain
> executive request became assigned work, a real deliverable, a human review
> boundary, and retained evidence that can be inspected later.

## Repetition and determinism

The six numeric results above must be identical on every run because the input
and calculation contract are fixed. Natural-language wording, execution time,
token count, generated file hash, and timestamps may vary between model runs.
Do not claim byte-for-byte determinism from a generative model.

For an exact rehearsal, factory-reset the instance before the next run. A
prepared walkthrough may exist for presenter recovery, but it is deliberately
outside the browser agent's prompt and must never cause the agent to search the
computer or execute a local script.

## Failure transition

There is no elapsed-time failure transition. `Working` or `In Progress` means
the run is still alive, regardless of how many minutes have passed. Continue
waiting and checking the same task until Foundation reports a terminal state.

Stop only when one of these is visibly true in Foundation:

- the task finished and the closure steps can continue;
- the run explicitly failed or was cancelled;
- the task is blocked and names a concrete intervention the user must perform;
- Foundation itself is unavailable after one normal page reload.

Elapsed time alone is never a reason to stop, retry, switch tasks or report an
incomplete run. The browser operator must not execute a fallback script, open
Finder, inspect local files, switch to prepared data, retry a still-live run,
hire another agent or repair permissions.
