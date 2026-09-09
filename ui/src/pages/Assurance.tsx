import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/router";
import { FileCheck2, Plus, ShieldCheck } from "lucide-react";
import { assuranceApi } from "@/api/assurance";
import { projectsApi } from "@/api/projects";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssuranceStateBadge } from "@/components/assurance/AssuranceStateBadge";

export function Assurance() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  useEffect(() => setBreadcrumbs([{ label: "Assurance" }]), [setBreadcrumbs]);
  const overview = useQuery({
    queryKey: queryKeys.assurance.overview(selectedCompanyId ?? ""),
    queryFn: () => assuranceApi.overview(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const dossiers = useQuery({
    queryKey: queryKeys.assurance.dossiers(selectedCompanyId ?? ""),
    queryFn: () => assuranceApi.listDossiers(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId ?? ""),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const create = useMutation({
    mutationFn: () => assuranceApi.createProjectDossier(projectId, title.trim()),
    onSuccess: (dossier) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assurance.overview(selectedCompanyId ?? "") });
      navigate(`/assurance/dossiers/${dossier.id}`);
    },
  });
  if (!selectedCompanyId) return <p className="text-sm text-muted-foreground">Selecciona una empresa primero.</p>;
  const metrics = overview.data;

  return (
    <div className="mx-auto w-full max-w-(--foundation-content-max) space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h1 className="text-xl font-semibold">Assurance</h1></div><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Dossiers verificables que conectan ejecuciones, evidencia, coste y decisión humana sin publicar datos internos.</p></div>
        <Button onClick={() => setCreating((value) => !value)}><Plus className="size-4" /> Nuevo dossier</Button>
      </div>
      {creating ? (
        <form className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (title.trim() && projectId) create.mutate(); }}>
          <Input aria-label="Título del dossier" placeholder="Título del dossier" value={title} onChange={(event) => setTitle(event.target.value)} />
          <select aria-label="Proyecto" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Selecciona un proyecto</option>
            {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <Button type="submit" disabled={!title.trim() || !projectId || create.isPending}>Crear</Button>
          {create.error ? <p className="text-sm text-destructive sm:col-span-3">{create.error.message}</p> : null}
        </form>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Listos para cerrar", metrics?.readyToSeal ?? 0], ["Requieren atención", metrics?.requiresAttention ?? 0], ["Borradores", metrics?.drafts ?? 0], ["Cerrados", metrics?.sealed ?? 0]].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>
        ))}
      </div>
      {overview.data?.exceptions.length ? (
        <section className="rounded-lg border border-destructive/20 bg-destructive/5 p-4"><h2 className="text-sm font-semibold">Excepciones recientes</h2><div className="mt-3 space-y-2">{overview.data.exceptions.slice(0, 5).map((exception) => <Link key={exception.issueId} to={`/issues/${exception.issueId}`} className="flex items-center justify-between gap-3 text-sm hover:underline"><span className="truncate">{exception.title}</span><AssuranceStateBadge state={exception.state} /></Link>)}</div></section>
      ) : null}
      <section><h2 className="mb-3 text-sm font-semibold">Dossiers</h2><div className="overflow-hidden rounded-lg border border-border bg-card">
        {(dossiers.data ?? []).map((dossier) => <Link key={dossier.id} to={`/assurance/dossiers/${dossier.id}`} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/40"><FileCheck2 className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{dossier.title}</span><span className="text-xs text-muted-foreground">{dossier.taskCount} tareas · {dossier.exceptionCount} excepciones</span><AssuranceStateBadge state={dossier.status} /></Link>)}
        {!dossiers.isLoading && !dossiers.data?.length ? <p className="p-10 text-center text-sm text-muted-foreground">Crea el primer dossier verificable de Foundation.</p> : null}
      </div></section>
      {overview.error || dossiers.error ? <p className="text-sm text-destructive">{(overview.error ?? dossiers.error)?.message}</p> : null}
    </div>
  );
}
