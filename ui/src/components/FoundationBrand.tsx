import { cn, SIDEBAR_RAIL_HIDDEN_LABEL } from "@/lib/utils";

interface FoundationBrandProps {
  compact?: boolean;
  className?: string;
}

/** Foundation brand using the same canonical Pillar geometry as the favicon. */
export function FoundationBrand({ compact = false, className }: FoundationBrandProps) {
  return (
    <div
      aria-label="Foundation · Davaria"
      className={cn(
        "flex min-w-0 items-center gap-2.5 text-foundation-sidebar-foreground",
        compact && "justify-center",
        className,
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
        <img src="/foundation-mark.svg?v=pillar-4" alt="" className="size-6" />
      </span>
      <span className={compact ? SIDEBAR_RAIL_HIDDEN_LABEL : "min-w-0 leading-none"}>
        <span className="block truncate text-(length:--text-compact) font-semibold tracking-tight">
          Foundation
        </span>
        <span className="mt-1 block text-(length:--text-micro) font-medium text-foundation-sidebar-muted">
          Davaria
        </span>
      </span>
    </div>
  );
}
