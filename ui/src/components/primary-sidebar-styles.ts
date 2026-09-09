/**
 * Shared visual contract for the Streamlined UI primary navigation surface.
 * Settings reuses this contract when it takes over the global sidebar.
 */
export const primarySidebarStyles = {
  surface: "foundation-sidebar",
  nav: "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto scrollbar-auto-hide px-2 py-1.5 pointer-coarse:gap-3",
  group: "flex flex-col gap-0.5",
} as const;
