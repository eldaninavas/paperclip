import { useMemo, useState } from "react";
import { Dice5, Upload } from "lucide-react";

import {
  AGENT_IDENTITY_ACCESSORIES,
  AGENT_IDENTITY_FACES,
  AGENT_IDENTITY_PALETTES,
  AGENT_IDENTITY_SHAPES,
  AgentCharacter,
  DEFAULT_AGENT_IDENTITY,
  agentIdentityPaletteBackground,
  parseAgentIdentity,
  serializeAgentIdentity,
  type AgentIdentityValue,
} from "./AgentIdentity";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAgentIcon } from "../lib/agent-icons";

const LEGACY_DEFAULT_ICON = "bot";

function identityStateFromStatus(status: string | null | undefined) {
  if (status === "running") return "working" as const;
  if (status === "succeeded" || status === "completed" || status === "done") return "done" as const;
  if (status === "paused") return "waiting" as const;
  if (status === "error" || status === "failed" || status === "terminated") return "blocked" as const;
  if (status === "pending_approval") return "thinking" as const;
  return "idle" as const;
}

export function AgentIcon({ icon, className, status }: { icon: string | null | undefined; className?: string; status?: string | null }) {
  const identity = parseAgentIdentity(icon);
  if (identity) return <AgentCharacter identity={identity} state={identityStateFromStatus(status)} className={className} />;
  const Icon = getAgentIcon(icon ?? LEGACY_DEFAULT_ICON);
  return <Icon className={className} />;
}

function nextRandomIdentity(current: AgentIdentityValue): AgentIdentityValue {
  const pickDifferent = <T,>(items: readonly T[], previous: T): T => {
    const choices = items.filter((item) => item !== previous);
    return choices[Math.floor(Math.random() * choices.length)] ?? previous;
  };
  return {
    shape: pickDifferent(AGENT_IDENTITY_SHAPES, current.shape),
    palette: pickDifferent(AGENT_IDENTITY_PALETTES, current.palette),
    face: AGENT_IDENTITY_FACES[Math.floor(Math.random() * AGENT_IDENTITY_FACES.length)],
    accessory: AGENT_IDENTITY_ACCESSORIES[Math.floor(Math.random() * AGENT_IDENTITY_ACCESSORIES.length)],
  };
}

export function AgentIdentityStudio({
  value,
  onChange,
  compact = false,
}: {
  value: string | null | undefined;
  onChange: (icon: string) => void;
  compact?: boolean;
}) {
  const selected = useMemo(() => parseAgentIdentity(value) ?? DEFAULT_AGENT_IDENTITY, [value]);
  const update = (patch: Partial<AgentIdentityValue>) => onChange(serializeAgentIdentity({ ...selected, ...patch }));

  return (
    <div className="space-y-3">
      <div className={cn("flex items-center justify-center", compact ? "py-0.5" : "py-1")}>
        <AgentCharacter identity={selected} className={compact ? "size-16" : "size-20"} />
      </div>

      <div className="grid grid-cols-8 gap-1" aria-label="Agent shapes">
        {AGENT_IDENTITY_SHAPES.map((shape) => (
          <button key={shape} type="button" aria-label={`${shape} shape`} aria-pressed={selected.shape === shape} onClick={() => update({ shape })}
            className={cn("flex aspect-square items-center justify-center rounded-lg border transition-[background-color,border-color] duration-(--motion-duration-exit) hover:bg-accent", selected.shape === shape ? "border-foreground/35 bg-accent" : "border-transparent")}
          >
            <AgentCharacter identity={{ ...selected, shape }} animated={false} className="size-7" />
          </button>
        ))}
      </div>

      <div className="border-t border-border/70 pt-3">
        <div className="grid grid-cols-10 gap-2" aria-label="Agent colors">
          {AGENT_IDENTITY_PALETTES.map((palette) => (
            <button key={palette} type="button" aria-label={`${palette} color`} aria-pressed={selected.palette === palette} onClick={() => update({ palette })}
              className={cn(
                "flex aspect-square items-center justify-center rounded-full border transition-transform hover:scale-105",
                selected.palette === palette
                  ? "border-foreground/50 ring-2 ring-foreground/15 ring-offset-2 ring-offset-background"
                  : "border-transparent",
              )}
            >
              <span
                className="size-6 rounded-full"
                style={{ background: agentIdentityPaletteBackground(palette) }}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(serializeAgentIdentity(DEFAULT_AGENT_IDENTITY))}>Reset</Button>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(serializeAgentIdentity(nextRandomIdentity(selected)))}>
            <Dice5 className="size-3.5" /> Generate
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled title="Custom uploads are coming next">
            <Upload className="size-3.5" /> Upload
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgentIconPicker({ value, onChange, children }: { value: string | null | undefined; onChange: (icon: string) => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-96 p-4" align="start">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Bot identity</p>
            <p className="text-xs text-muted-foreground">Make this agent recognizable at a glance.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Done</Button>
        </div>
        <AgentIdentityStudio value={value} onChange={onChange} compact />
      </PopoverContent>
    </Popover>
  );
}
