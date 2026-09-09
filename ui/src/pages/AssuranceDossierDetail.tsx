import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@/lib/router";
import { Download, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { assuranceApi } from "@/api/assurance";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AssuranceStateBadge } from "@/components/assurance/AssuranceStateBadge";

export function AssuranceDossierDetail() {
  const { dossierId = "" } = useParams<{ dossierId: string }>();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.assurance.dossier(dossierId), queryFn: () => assuranceApi.dossier(dossierId), enabled: Boolean(dossierId) });
  useEffect(() => setBreadcrumbs([{ label: "Assurance", href: "/assurance" }, { label: query.data?.title ?? "Dossier" }]), [query.data?.title, setBreadcrumbs]);
  const refresh = useMutation({ mutationFn: () => assuranceApi.refreshDossier(dossierId), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assurance.dossier(dossierId) }) });
  const requestApproval = useMutation({ mutationFn: () => assuranceApi.requestApproval(dossierId), onSuccess: ({ approval }) => navigate(`/approvals/${approval.id}`) });
  const seal = useMutation({ mutationFn: () => assuranceApi.sealDossier(dossierId, query.data!.inputDigest), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assurance.dossier(dossierId) }) });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Cargando dossier…</p>;
  if (query.error || !query.data) return <p className="text-sm text-destructive">{query.error?.message ?? "Dossier no encontrado"}</p>;
  const dossier = query.data;
  const latest = dossier.versions[0];
  const actionError = refresh.error ?? requestApproval.error ?? seal.error;

  return (
    <div className="mx-auto w-full max-w-(--foundation-content-max) space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h1 className="text-xl font-semibold">{dossier.title}</h1><AssuranceStateBadge state={dossier.status} /></div><p className="mt-1 text-sm text-muted-foreground">Huella de entrada <code className="font-mono">{dossier.inputDigest.slice(0, 16)}…</code></p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={refresh.isPending || dossier.status === "sealed"} onClick={() => refresh.mutate()}><RefreshCw className="size-4" /> Actualizar</Button><Button variant="outline" disabled={requestApproval.isPending || dossier.status === "sealed"} onClick={() => requestApproval.mutate()}>Solicitar aprobación</Button><Button disabled={seal.isPending || dossier.status !== "ready"} onClick={() => seal.mutate()}>Cerrar versión</Button></div></div>
      {actionError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionError.message}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Tareas</p><p className="mt-1 text-xl font-semibold">{dossier.taskCount}</p></div><div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Excepciones</p><p className="mt-1 text-xl font-semibold">{dossier.exceptionCount}</p></div><div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Versiones inmutables</p><p className="mt-1 text-xl font-semibold">{dossier.versions.length}</p></div></div>
      <section><h2 className="mb-3 text-sm font-semibold">Tareas incluidas</h2><div className="overflow-hidden rounded-lg border border-border bg-card">{dossier.items.map((item) => <Link key={item.id} to={`/issues/${item.issueId}`} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/40"><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.issueTitle}</span><span className="text-xs text-muted-foreground">{item.validation.totals.runs} ejecuciones · {item.validation.totals.deliverables} entregables</span><AssuranceStateBadge state={item.validation.state} /></Link>)}</div></section>
      {latest ? <section className="rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Versión {latest.version}</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">SHA-256 {latest.manifestSha256}</p><Link to={`/verify/${dossier.publicId}`} className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">Verificación pública <ExternalLink className="size-3.5" /></Link></div><img src={`/api/public/assurance/qr/${dossier.publicId}.svg`} alt="QR de verificación pública" className="size-28 rounded-md border border-border bg-white p-1" /></div><div className="mt-4 flex flex-wrap gap-2">{(["manifest", "xml", "pdf", "bundle"] as const).map((artifact) => <a key={artifact} href={assuranceApi.artifactUrl(dossier.id, artifact)} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" /> {artifact === "bundle" ? "bundle.zip" : artifact === "pdf" ? "report.pdf" : artifact === "xml" ? "evidence.xml" : "manifest.json"}</a>)}</div><p className="mt-4 text-xs text-muted-foreground">Firma: {latest.signatureAlgorithm ?? "no configurada"}. Sello de tiempo: {latest.timestampStatus}.</p></section> : null}
    </div>
  );
}
