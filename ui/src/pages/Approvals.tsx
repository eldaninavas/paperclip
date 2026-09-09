import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { CheckCircle2, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../components/ApprovalCard";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";

type StatusFilter = "pending" | "all";

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Revisión humana" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: reviewIssues, isLoading: reviewIssuesLoading, error: reviewIssuesError } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "in-review"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { status: "in_review" }),
    enabled: !!selectedCompanyId,
  });

  const reviewIssueMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "changes" }) =>
      issuesApi.update(id, decision === "approve"
        ? { status: "done", comment: "Aprobada por revisión humana." }
        : { status: "todo", comment: "Revisión humana: se solicitaron cambios." }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "No se pudo registrar la decisión");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const filtered = (data ?? [])
    .filter(
      (a) => statusFilter === "all" || a.status === "pending" || a.status === "revision_requested",
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingApprovalCount = (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length;
  const pendingCount = pendingApprovalCount + (reviewIssues?.length ?? 0);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Selecciona una empresa primero.</p>;
  }

  if (isLoading || reviewIssuesLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="mx-auto w-full max-w-(--foundation-content-max) space-y-5">
      <div className="flex items-end justify-between gap-4">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <PageTabBar items={[
            { value: "pending", label: <>Pendientes{pendingCount > 0 && (
              <Badge variant="ghost" className={cn(
                "ml-1.5 px-1.5 text-(length:--text-nano)",
                "bg-yellow-500/20 text-yellow-500"
              )}>
                {pendingCount}
              </Badge>
            )}</> },
            { value: "all", label: "Todas" },
          ]} />
        </Tabs>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/[0.045] px-4 py-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <LockKeyhole className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">La decisión final pertenece a una persona</p>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted-foreground">
            Los agentes pueden ejecutar y entregar trabajo, pero no aprobar su propia finalización. Cada decisión queda registrada con la identidad del responsable.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {reviewIssuesError && <p className="text-sm text-destructive">{reviewIssuesError.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {statusFilter === "pending" && (reviewIssues?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tareas listas para revisar</h2>
            <span className="text-xs text-muted-foreground">Sólo humanos</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            {reviewIssues!.map((issue) => (
              <div key={issue.id} className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
                <Link to={`/issues/${issue.identifier ?? issue.id}`} className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{issue.identifier}</span>
                    <span className="truncate text-sm font-medium text-foreground">{issue.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">El agente terminó su trabajo y cedió la decisión.</p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={reviewIssueMutation.isPending}
                    onClick={() => reviewIssueMutation.mutate({ id: issue.id, decision: "changes" })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <RotateCcw className="size-3.5" /> Pedir cambios
                  </button>
                  <button
                    type="button"
                    disabled={reviewIssueMutation.isPending}
                    onClick={() => reviewIssueMutation.mutate({ id: issue.id, decision: "approve" })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-3.5" /> Aprobar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && (statusFilter === "all" || (reviewIssues?.length ?? 0) === 0) && (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-(--foundation-surface-subtle) px-6 text-center">
          <div className="mb-4 flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {statusFilter === "pending"
              ? "No hay nada por revisar. Cuando un agente termine una tarea, la decisión final aparecerá aquí."
              : "Todavía no hay decisiones registradas."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm [&>[data-slot=card]+[data-slot=card]]:border-t">
          {filtered.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              requesterAgent={approval.requestedByAgentId ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null : null}
              onApprove={() => approveMutation.mutate(approval.id)}
              onReject={() => rejectMutation.mutate(approval.id)}
              detailLink={`/approvals/${approval.id}`}
              isPending={approveMutation.isPending || rejectMutation.isPending}
              pendingAction={
                approveMutation.isPending ? "approve" : rejectMutation.isPending ? "reject" : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
