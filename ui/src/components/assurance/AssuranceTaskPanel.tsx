import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, RefreshCw, ShieldCheck } from "lucide-react";
import { assuranceApi } from "@/api/assurance";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AssuranceStateBadge } from "./AssuranceStateBadge";

export function AssuranceTaskPanel({ issueId }: { issueId: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.assurance.issue(issueId),
    queryFn: () => assuranceApi.issue(issueId),
    enabled: Boolean(issueId),
  });
  const validate = useMutation({
    mutationFn: () => assuranceApi.validateIssue(issueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assurance.issue(issueId) }),
  });
  const latest = query.data?.latestValidation;
  const checks = latest?.checks ?? [];
  const passedChecks = checks.filter((check) => check.state === "passed").length;

  return (
    <section className="rounded-lg border border-border bg-card px-3 py-2.5" aria-labelledby="task-assurance-title">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls="task-assurance-checks"
          onClick={() => setExpanded((value) => !value)}
        >
            <ShieldCheck className="size-4 text-primary" />
            <h2 id="task-assurance-title" className="text-sm font-semibold">Assurance</h2>
            {latest ? <AssuranceStateBadge state={latest.state} /> : null}
            {latest ? (
              <span className="truncate text-xs text-muted-foreground">
                {passedChecks}/{checks.length} comprobaciones
              </span>
            ) : query.isLoading ? (
              <span className="text-xs text-muted-foreground">Comprobando…</span>
            ) : null}
            <ChevronDown className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <Button className="h-7 shrink-0 px-2 text-xs" size="sm" variant="outline" disabled={validate.isPending} onClick={() => validate.mutate()}>
          <RefreshCw className="size-3.5" /> {validate.isPending ? "Validando…" : "Validar ahora"}
        </Button>
      </div>
      {query.error ? <p className="mt-2 text-xs text-destructive">{query.error.message}</p> : null}
      {validate.error ? <p className="mt-2 text-xs text-destructive">{validate.error.message}</p> : null}
      {expanded ? (
        <div id="task-assurance-checks" className="mt-3 border-t border-border pt-3">
          <p className="mb-3 text-xs leading-5 text-muted-foreground">
            Evidencia, coste, entregables y aprobación ligados a una huella exacta de esta tarea.
          </p>
          {latest ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {checks.map((check) => (
                <div key={check.key} className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                  <CheckCircle2 className={check.state === "passed" ? "mt-0.5 size-3.5 text-emerald-500" : "mt-0.5 size-3.5 text-muted-foreground"} />
                  <div><p className="font-medium">{check.label}</p>{check.detail ? <p className="text-muted-foreground">{check.detail}</p> : null}</div>
                </div>
              ))}
            </div>
          ) : query.isLoading ? (
            <p className="text-xs text-muted-foreground">Comprobando evidencia…</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
