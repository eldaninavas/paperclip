import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export const AGENT_IDENTITY_SHAPES = [
  "circle",
  "oval",
  "square",
  "pill",
  "triangle",
  "hexagon",
  "cloud",
  "drop",
] as const;

export const AGENT_IDENTITY_PALETTES = [
  "mint",
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "gold",
  "green",
  "sky",
  "slate",
] as const;

export const AGENT_IDENTITY_FACES = ["bright", "calm", "focused", "curious"] as const;
export const AGENT_IDENTITY_ACCESSORIES = ["none", "tuft", "antenna", "spark"] as const;

export type AgentIdentityShape = (typeof AGENT_IDENTITY_SHAPES)[number];
export type AgentIdentityPalette = (typeof AGENT_IDENTITY_PALETTES)[number];
export type AgentIdentityFace = (typeof AGENT_IDENTITY_FACES)[number];
export type AgentIdentityAccessory = (typeof AGENT_IDENTITY_ACCESSORIES)[number];
export type AgentIdentityState = "idle" | "thinking" | "working" | "waiting" | "blocked" | "done";

export interface AgentIdentityValue {
  shape: AgentIdentityShape;
  palette: AgentIdentityPalette;
  face: AgentIdentityFace;
  accessory: AgentIdentityAccessory;
}

export const DEFAULT_AGENT_IDENTITY: AgentIdentityValue = {
  shape: "hexagon",
  palette: "mint",
  face: "bright",
  accessory: "none",
};

const IDENTITY_PREFIX = "agent:v1:";

const PALETTE_STOPS: Record<AgentIdentityPalette, readonly [string, string]> = {
  mint: ["var(--agent-10b)", "var(--agent-8a)"],
  blue: ["var(--agent-5a)", "var(--agent-7a)"],
  violet: ["var(--agent-3a)", "var(--agent-8b)"],
  pink: ["var(--agent-2b)", "var(--agent-1a)"],
  red: ["var(--agent-6a)", "var(--agent-3b)"],
  orange: ["var(--agent-6a)", "var(--agent-9a)"],
  gold: ["var(--agent-10a)", "var(--agent-4b)"],
  green: ["var(--agent-5b)", "var(--agent-8a)"],
  sky: ["var(--agent-7a)", "var(--agent-10b)"],
  slate: ["var(--status-agent-idle)", "var(--muted-foreground)"],
};

export function agentIdentityPaletteBackground(palette: AgentIdentityPalette) {
  const stops = PALETTE_STOPS[palette];
  return `linear-gradient(145deg, ${stops[0]}, ${stops[1]})`;
}

export function serializeAgentIdentity(value: AgentIdentityValue): string {
  return `${IDENTITY_PREFIX}${value.shape}:${value.palette}:${value.face}:${value.accessory}`;
}

export function parseAgentIdentity(value: string | null | undefined): AgentIdentityValue | null {
  if (!value?.startsWith(IDENTITY_PREFIX)) return null;
  const [shape, palette, face, accessory] = value.slice(IDENTITY_PREFIX.length).split(":");
  if (
    !AGENT_IDENTITY_SHAPES.includes(shape as AgentIdentityShape) ||
    !AGENT_IDENTITY_PALETTES.includes(palette as AgentIdentityPalette) ||
    !AGENT_IDENTITY_FACES.includes(face as AgentIdentityFace) ||
    !AGENT_IDENTITY_ACCESSORIES.includes(accessory as AgentIdentityAccessory)
  ) return null;
  return {
    shape: shape as AgentIdentityShape,
    palette: palette as AgentIdentityPalette,
    face: face as AgentIdentityFace,
    accessory: accessory as AgentIdentityAccessory,
  };
}

function Body({ shape, fill }: { shape: AgentIdentityShape; fill: string }) {
  switch (shape) {
    case "circle": return <circle cx="50" cy="52" r="36" fill={fill} />;
    case "oval": return <ellipse cx="50" cy="54" rx="41" ry="29" fill={fill} />;
    case "square": return <rect x="14" y="16" width="72" height="72" rx="21" fill={fill} />;
    case "pill": return <rect x="8" y="30" width="84" height="51" rx="25.5" fill={fill} />;
    case "triangle": return <path d="M50 10C54 10 57 12 60 17L91 75C95 83 90 90 81 90H19C10 90 5 83 9 75L40 17C43 12 46 10 50 10Z" fill={fill} />;
    case "hexagon": return <path d="M50 7C54 7 57 8 61 10L82 22C87 25 90 30 90 36V65C90 71 87 76 82 79L61 91C57 93 54 94 50 94C46 94 43 93 39 91L18 79C13 76 10 71 10 65V36C10 30 13 25 18 22L39 10C43 8 46 7 50 7Z" fill={fill} />;
    case "cloud": return <path d="M20 78C10 78 5 70 8 60C10 52 17 47 25 48C25 33 36 22 50 22C61 22 70 29 74 39C86 38 94 47 94 59C94 70 86 78 75 78H20Z" fill={fill} />;
    case "drop": return <path d="M50 7C50 7 84 46 84 67C84 86 69 96 50 96C31 96 16 86 16 67C16 46 50 7 50 7Z" fill={fill} />;
  }
}

function Eyes({ face, state }: { face: AgentIdentityFace; state: AgentIdentityState }) {
  if (state === "waiting") {
    return <><path d="M27 60Q35 66 43 60" fill="none" stroke="var(--pill-guy-eye)" strokeWidth="5" strokeLinecap="round" /><path d="M57 60Q65 66 73 60" fill="none" stroke="var(--pill-guy-eye)" strokeWidth="5" strokeLinecap="round" /></>;
  }
  if (state === "blocked") {
    return <><path d="M28 64L41 57" stroke="var(--pill-guy-eye)" strokeWidth="6" strokeLinecap="round" /><path d="M59 57L72 64" stroke="var(--pill-guy-eye)" strokeWidth="6" strokeLinecap="round" /></>;
  }
  if (state === "done") {
    return <><path d="M27 61Q35 54 43 61" fill="none" stroke="var(--pill-guy-eye)" strokeWidth="5" strokeLinecap="round" /><path d="M57 61Q65 54 73 61" fill="none" stroke="var(--pill-guy-eye)" strokeWidth="5" strokeLinecap="round" /></>;
  }
  if (face === "calm") {
    return <><rect x="29" y="57" width="13" height="5" rx="2.5" fill="var(--pill-guy-eye)" /><rect x="59" y="57" width="13" height="5" rx="2.5" fill="var(--pill-guy-eye)" /></>;
  }
  if (face === "focused") {
    return <><rect x="29" y="53" width="9" height="17" rx="4.5" fill="var(--pill-guy-eye)" transform="rotate(12 33.5 61.5)" /><rect x="63" y="53" width="9" height="17" rx="4.5" fill="var(--pill-guy-eye)" transform="rotate(-12 67.5 61.5)" /></>;
  }
  if (face === "curious") {
    return <><circle cx="35" cy="60" r="5" fill="var(--pill-guy-eye)" /><rect x="61" y="51" width="10" height="18" rx="5" fill="var(--pill-guy-eye)" /></>;
  }
  return <><rect x="29" y="52" width="10" height="18" rx="5" fill="var(--pill-guy-eye)" transform="rotate(-8 34 61)" /><rect x="62" y="52" width="10" height="18" rx="5" fill="var(--pill-guy-eye)" transform="rotate(-8 67 61)" /></>;
}

function Accessory({ accessory }: { accessory: AgentIdentityAccessory }) {
  if (accessory === "tuft") return <path d="M29 24C24 14 30 7 40 13C47 2 58 5 59 17C68 10 77 16 71 27Z" fill="var(--pill-guy-eye)" opacity="0.88" />;
  if (accessory === "antenna") return <><path d="M50 24V12" stroke="var(--pill-guy-eye)" strokeWidth="4" strokeLinecap="round" /><circle cx="50" cy="8" r="5" fill="var(--pill-guy-eye)" /></>;
  if (accessory === "spark") return <path d="M79 17L83 27L93 31L83 35L79 45L75 35L65 31L75 27Z" fill="var(--pill-guy-eye)" />;
  return null;
}

export function AgentCharacter({
  identity,
  state = "idle",
  animated = true,
  className,
}: {
  identity: AgentIdentityValue;
  state?: AgentIdentityState;
  animated?: boolean;
  className?: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const reducedMotion = useReducedMotion();
  const stops = PALETTE_STOPS[identity.palette];
  const working = state === "working" || state === "thinking";

  return (
    <motion.svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Agent identity, ${identity.shape} shape`}
      className={cn("overflow-visible", className)}
      animate={reducedMotion || !animated ? undefined : working
        ? { y: [0, -4, 0, -1, 0], rotate: [0, -3, 2, -1, 0], scale: [1, 1.035, 0.985, 1.015, 1] }
        : { y: [0, -1, 0], scale: [1, 1.015, 1] }}
      transition={{ duration: working ? 1.25 : 3.2, repeat: Infinity, ease: "easeInOut" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="20" y1="10" x2="80" y2="94" gradientUnits="userSpaceOnUse">
          <stop stopColor={stops[0]} />
          <stop offset="1" stopColor={stops[1]} />
        </linearGradient>
      </defs>
      <Body shape={identity.shape} fill={`url(#${gradientId})`} />
      <motion.g
        animate={reducedMotion || !animated
          ? undefined
          : working
            ? { x: [0, 2, -1, 0], scaleY: [1, 0.88, 1, 1] }
            : state === "idle"
              ? { scaleY: [1, 1, 0.12, 1, 1] }
              : undefined}
        transition={{ duration: working ? 1.25 : 4.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "50px 61px" }}
      >
        <Eyes face={identity.face} state={state} />
      </motion.g>
      <Accessory accessory={identity.accessory} />
      {state === "thinking" ? <motion.circle cx="88" cy="16" r="4" fill="var(--foreground)" animate={reducedMotion || !animated ? undefined : { opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity }} /> : null}
    </motion.svg>
  );
}
