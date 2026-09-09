import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/router";
import { FileCheck2, Plus } from "lucide-react";
import { assuranceApi } from "@/api/assurance";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AssuranceStateBadge } from "./AssuranceStateBadge";

export function ProjectAssurancePanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: queryKeys.assurance.project(projectId), queryFn: () => assuranceApi.project(projectId) });
  const create = useMutation({
    mutationFn: () => assuranceApi.createProjectDossier(projectId, `Dossier — ${projectName}`),
    onSuccess: (dossier) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assurance.project(projectId) });
      navigate(`/assurance/dossiers/${dossier.id}`);
    },
  });
  const coverage = query.data?.coverage;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">Cobertura Assurance</h2><p className="text-sm text-muted-foreground">Validación reproducible del trabajo cerrado en este proyecto.</p></div>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}><Plus className="size-4" /> Crear dossier</Button>
      </div>
      {query.error || create.error ? <p className="text-sm text-destructive">{(query.error ?? create.error)?.message}</p> : null}
      {coverage ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[["Tareas", coverage.tasks], ["Válidas", coverage.valid], ["Atención", coverage.incomplete], ["Ejecuciones", coverage.runs], ["Entregables", coverage.deliverables], ["Coste", `${(coverage.costCents / 100).toFixed(2)} €`]].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {(query.data?.dossiers ?? []).map((dossier) => (
          <Link key={dossier.id} to={`/assurance/dossiers/${dossier.id}`} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/40">
            <FileCheck2 className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{dossier.title}</span><span className="text-xs text-muted-foreground">{dossier.taskCount} tareas</span><AssuranceStateBadge state={dossier.status} />
          </Link>
        ))}
        {!query.isLoading && !query.data?.dossiers.length ? <p className="p-6 text-center text-sm text-muted-foreground">Todavía no hay dossiers para este proyecto.</p> : null}
      </div>
    </div>
  );
}
