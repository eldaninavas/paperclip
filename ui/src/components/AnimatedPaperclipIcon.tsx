import type { SVGProps } from "react";
import { cn } from "../lib/utils";

export function AnimatedPaperclipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 80 80"
      className={cn("paperclip-thinking-icon", className)}
      aria-hidden="true"
      {...props}
    >
      <image href="/foundation-mark.svg?v=pillar-2" width="80" height="80" />
    </svg>
  );
}

/** Full-page loading state using the Foundation mark. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <AnimatedPaperclipIcon className="h-24 w-24 text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
