import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Identity } from "./Identity";
import {
  approvalSubject,
  typeIcon,
  defaultTypeIcon,
  ApprovalPayloadRenderer,
  typeLabel,
} from "./ApprovalPayload";
import { timeAgo } from "../lib/timeAgo";
import type { Approval, Agent } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

function statusIcon(status: string) {
  if (status === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
  if (status === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />;
  if (status === "revision_requested") return <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  if (status === "pending") return <Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />;
  return null;
}

export function ApprovalCard({
  approval,
  requesterAgent,
  onApprove,
  onReject,
  onOpen,
  detailLink,
  isPending = false,
  pendingAction = null,
}: {
  approval: Approval;
  requesterAgent: Agent | null;
  onApprove?: () => void;
  onReject?: () => void;
  onOpen?: () => void;
  detailLink?: string;
  isPending?: boolean;
  pendingAction?: "approve" | "reject" | null;
}) {
  const payload = approval.payload as Record<string, unknown> | null;
  const Icon = typeIcon[approval.type] ?? defaultTypeIcon;
  const kindLabel = typeLabel[approval.type] ?? approval.type;
  const subject = approvalSubject(payload);
  const showResolutionButtons =
    Boolean(onApprove && onReject) &&
    approval.type !== "budget_override_required" &&
    (approval.status === "pending" || approval.status === "revision_requested");
  const hasFooter = showResolutionButtons || Boolean(detailLink || onOpen);

  return (
    <Card className="group block gap-0 rounded-none border-0 bg-card py-0 shadow-none transition-colors hover:bg-accent/20">
      <div className="flex items-start justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-(--foundation-surface-subtle)">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-border bg-transparent px-1.5 py-0.5 text-(length:--text-micro) font-medium uppercase tracking-(--tracking-label) text-muted-foreground"
                >
                  {kindLabel}
                </Badge>
                {requesterAgent && (
                  <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Requested by</span>
                    <Identity name={requesterAgent.name} size="sm" className="inline-flex" />
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold leading-5 text-foreground">
                  {subject ?? kindLabel}
                </h3>
                <p className="text-xs leading-5 text-muted-foreground">
                  Solicitada {timeAgo(approval.createdAt)}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-(--foundation-surface-subtle) px-2 py-1 text-xs text-muted-foreground">
            {statusIcon(approval.status)}
            <span className="capitalize">{approval.status.replace(/_/g, " ")}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border/70 bg-(--foundation-surface-subtle) px-4 py-3">
        <ApprovalPayloadRenderer
          type={approval.type}
          payload={approval.payload}
          hidePrimaryTitle={Boolean(subject)}
        />
      </div>

      {approval.decisionNote && (
        <div className="mx-4 mb-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Decision note.</span> {approval.decisionNote}
        </div>
      )}

      {hasFooter ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {showResolutionButtons && (
              <>
                <Button
                  size="sm"
                  onClick={onApprove}
                  disabled={isPending}
                >
                  {pendingAction === "approve" ? "Aceptando..." : "Aceptar"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onReject}
                  disabled={isPending}
                >
                  {pendingAction === "reject" ? "Rechazando..." : "Rechazar"}
                </Button>
              </>
            )}
          </div>
          {(detailLink || onOpen) ? (
            detailLink ? (
              <Link
                to={detailLink}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto px-2 text-xs text-muted-foreground")}
              >
                Ver detalles
              </Link>
            ) : (
              <Button variant="ghost" size="sm" className="h-auto px-2 text-xs text-muted-foreground" onClick={onOpen}>
                Ver detalles
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
