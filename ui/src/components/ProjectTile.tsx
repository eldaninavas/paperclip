import { cn } from "../lib/utils";
import { getProjectIcon } from "../lib/project-icons";
import { PROJECT_EMOJI_PREFIX, isProjectEmojiIcon } from "@paperclipai/shared";

/**
 * Reusable project tile (IA Phase 3 — PAP-58; icon picker added PAP-68 part 3).
 *
 * Default render is a neutral gray rounded rectangle with a cube icon.
 * An optional `color` tints the background; an optional `icon` selects which
 * Lucide glyph to render (defaults to `box`).
 *
 * Used by the Projects list rows and the project detail header. Both `color`
 * and `icon` live on the project itself (`project.color` / `project.icon`).
 */

export type ProjectTileSize = "xs" | "sm" | "md" | "lg";

const SIZE_STYLES: Record<ProjectTileSize, { box: string; icon: string }> = {
  xs: { box: "h-4 w-4 rounded-sm", icon: "h-2.5 w-2.5" },
  sm: { box: "h-6 w-6 rounded-md", icon: "h-3.5 w-3.5" },
  md: { box: "h-7 w-7 rounded-lg", icon: "h-4 w-4" },
  lg: { box: "h-9 w-9 rounded-lg", icon: "h-5 w-5" },
};

export interface ProjectTileProps {
  /** Optional project color. When unset, the tile stays neutral gray. */
  color?: string | null;
  /** Optional Lucide icon name. When unset, defaults to `box`. */
  icon?: string | null;
  size?: ProjectTileSize;
  className?: string;
}

export function ProjectTile({ color, icon, size = "md", className }: ProjectTileProps) {
  const dims = SIZE_STYLES[size];
  const tinted = Boolean(color);
  const emoji = icon && isProjectEmojiIcon(icon)
    ? icon.slice(PROJECT_EMOJI_PREFIX.length)
    : null;
  // Older projects persisted the previous default (`folder`). Keep those rows
  // aligned with Foundation's project language without requiring a data migration.
  const Icon = getProjectIcon(icon === "folder" ? "box" : icon);

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        dims.box,
        tinted ? "text-white" : "bg-muted text-muted-foreground",
        className,
      )}
      style={tinted ? { backgroundColor: color ?? undefined } : undefined}
    >
      {emoji ? (
        <span className={cn("flex items-center justify-center leading-none", dims.icon)}>{emoji}</span>
      ) : (
        <Icon className={dims.icon} />
      )}
    </span>
  );
}
