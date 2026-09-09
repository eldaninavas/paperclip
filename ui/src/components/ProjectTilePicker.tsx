import { useMemo, useState, type MouseEvent, type PointerEvent } from "react";
import { PROJECT_COLORS, PROJECT_EMOJI_PREFIX, PROJECT_ICON_NAMES } from "@paperclipai/shared";
import { Check } from "lucide-react";
import { PROJECT_ICONS } from "../lib/project-icons";
import { cn } from "../lib/utils";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ProjectTile, type ProjectTileSize } from "./ProjectTile";

const PROJECT_EMOJIS = [
  "🚀", "✨", "🔥", "💡", "🎯", "🧭", "🧠", "⚡",
  "🛠️", "🧪", "🔬", "🔐", "🛡️", "🌐", "📦", "💎",
  "🌱", "🌈", "🎨", "🎵", "🎬", "📚", "🏗️", "🤖",
  "👾", "🦄", "🐙", "🦊", "🐝", "🌙", "☀️", "❤️",
] as const;

type PickerTab = "icons" | "emojis";

export interface ProjectTilePickerProps {
  color: string | null;
  icon: string | null;
  onSelectIcon: (icon: string) => void;
  onSelectColor: (color: string | null) => void;
  size?: ProjectTileSize;
  stopNavigation?: boolean;
  disabled?: boolean;
}

export function ProjectTilePicker({
  color,
  icon,
  onSelectIcon,
  onSelectColor,
  size = "md",
  stopNavigation = false,
  disabled = false,
}: ProjectTilePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("icons");
  const [search, setSearch] = useState("");

  const filteredIcons = useMemo(() => {
    const entries = PROJECT_ICON_NAMES
      .filter((name) => name !== "folder")
      .map((name) => [name, PROJECT_ICONS[name]] as const);
    if (!search) return entries;
    const query = search.toLowerCase();
    return entries.filter(([name]) => name.includes(query));
  }, [search]);

  const containPointerEvent = (event: PointerEvent) => {
    if (stopNavigation) event.stopPropagation();
  };

  const handleTriggerClick = (event: MouseEvent) => {
    if (!stopNavigation) return;
    // This trigger can live inside an EntityRow link. Own the click and toggle
    // the controlled popover so changing identity never opens the project.
    event.preventDefault();
    event.stopPropagation();
    setOpen((current) => !current);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-entity-row-action={stopNavigation ? "true" : undefined}
          disabled={disabled}
          onPointerDown={containPointerEvent}
          onClick={handleTriggerClick}
          className="shrink-0 rounded-md outline-none transition-[transform,box-shadow,opacity] duration-150 hover:scale-105 hover:ring-2 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label="Change project icon, emoji, and color"
        >
          <ProjectTile color={color} icon={icon} size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 overflow-hidden p-0" align="start" sideOffset={6}>
        <div className="flex border-b border-border px-3 pt-2">
          {(["icons", "emojis"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                "relative px-2 py-2 text-xs font-medium capitalize text-muted-foreground transition-colors hover:text-foreground",
                tab === item && "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-px after:bg-foreground",
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="p-3">
          {tab === "icons" ? (
            <>
              <Input
                placeholder="Search icons..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="mb-2 h-8 text-xs"
                autoFocus
              />
              <div className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto pr-1">
                {filteredIcons.map(([name, Icon]) => {
                  const selected = (icon ?? "box") === name || (icon === "folder" && name === "box");
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => onSelectIcon(name)}
                      className={cn(
                        "relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 hover:scale-105 hover:bg-accent hover:text-foreground",
                        selected && "bg-accent text-foreground ring-1 ring-foreground/30",
                      )}
                      title={name}
                      aria-label={`Use ${name} icon`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
                {filteredIcons.length === 0 ? (
                  <p className="col-span-7 py-3 text-center text-xs text-muted-foreground">No matching icons</p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto pr-1">
              {PROJECT_EMOJIS.map((emoji) => {
                const value = `${PROJECT_EMOJI_PREFIX}${emoji}`;
                const selected = icon === value;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onSelectIcon(value)}
                    className={cn(
                      "relative flex h-8 w-8 items-center justify-center rounded-md text-base leading-none transition-[background-color,transform] duration-150 hover:scale-110 hover:bg-accent",
                      selected && "bg-accent ring-1 ring-foreground/30",
                    )}
                    aria-label={`Use ${emoji} emoji`}
                  >
                    {emoji}
                    {selected ? <Check className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-background" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Color</p>
          <div className="grid grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => onSelectColor(null)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-transform duration-150 hover:scale-110",
                color === null && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
              )}
              aria-label="Use neutral color"
            >
              <ProjectTile color={null} icon={icon} size="sm" />
            </button>
            {PROJECT_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => onSelectColor(swatch)}
                className={cn(
                  "h-7 w-7 rounded-md transition-[transform,box-shadow] duration-150 hover:scale-110 hover:ring-2 hover:ring-foreground/20",
                  color === swatch && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                )}
                style={{ backgroundColor: swatch }}
                aria-label={`Use color ${swatch}`}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
