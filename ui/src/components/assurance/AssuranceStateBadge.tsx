import type { AssuranceDossierState, AssuranceTaskValidationState } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const labels: Record<string, string> = {
  draft: "Borrador",
  ready: "Listo",
  blocked: "Requiere atención",
  sealing: "Cerrando",
  sealed: "Cerrado",
  superseded: "Sustituido",
  revoked: "Revocado",
  pending: "Pendiente",
  valid: "Válido",
  incomplete: "Incompleto",
  rejected: "Rechazado",
  stale: "Desactualizado",
};

export function AssuranceStateBadge({ state }: { state: AssuranceDossierState | AssuranceTaskValidationState | string }) {
  const positive = state === "valid" || state === "ready" || state === "sealed";
  const negative = state === "blocked" || state === "rejected" || state === "revoked" || state === "incomplete";
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        positive && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        negative && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {labels[state] ?? state}
    </Badge>
  );
}
