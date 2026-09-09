import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { adaptersApi } from "../api/adapters";
import { queryKeys } from "@/lib/queryKeys";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Bot,
  Check,
  MailPlus,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { buildAgentOnboardingPrompt } from "@/lib/agent-onboarding-prompt";
import { listUIAdapters } from "../adapters";
import { isVisualAdapterChoice } from "../adapters/metadata";
import { getAdapterDisplay } from "../adapters/adapter-display-registry";
import { useDisabledAdaptersSync } from "../adapters/use-disabled-adapters";
import { useToast } from "../context/ToastContext";
import { Badge } from "@/components/ui/badge";
import { AgentIcon, AgentIdentityStudio } from "./AgentIconPicker";
import { DEFAULT_AGENT_IDENTITY, serializeAgentIdentity } from "./AgentIdentity";

const DEFAULT_IDENTITY = serializeAgentIdentity(DEFAULT_AGENT_IDENTITY);

/**
 * Adapter types that are suitable for agent creation (excludes internal
 * system adapters like "process" and "http").
 */
const SYSTEM_ADAPTER_TYPES = new Set(["process", "http"]);

type NewAgentDialogMode = "choices" | "identity" | "runtime" | "invite" | "prompt";

function isAgentAdapterType(type: string): boolean {
  return !SYSTEM_ADAPTER_TYPES.has(type);
}

export function NewAgentDialog() {
  const { newAgentOpen, closeNewAgent, openNewIssue } = useDialog();
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<NewAgentDialogMode>("choices");
  const [agentMessage, setAgentMessage] = useState("");
  const [agentIcon, setAgentIcon] = useState(DEFAULT_IDENTITY);
  const [latestAgentPrompt, setLatestAgentPrompt] = useState<string | null>(null);
  const [latestAgentPromptCopied, setLatestAgentPromptCopied] = useState(false);
  const disabledTypes = useDisabledAdaptersSync();

  function resetDialogState() {
    setMode("choices");
    setAgentMessage("");
    setAgentIcon(DEFAULT_IDENTITY);
    setLatestAgentPrompt(null);
    setLatestAgentPromptCopied(false);
  }

  useEffect(() => {
    if (!latestAgentPromptCopied) return;
    const timeout = window.setTimeout(() => {
      setLatestAgentPromptCopied(false);
    }, 1600);
    return () => window.clearTimeout(timeout);
  }, [latestAgentPromptCopied]);

  // Fetch registered adapters from server (syncs disabled store + provides data)
  const { data: serverAdapters } = useQuery({
    queryKey: queryKeys.adapters.all,
    queryFn: () => adaptersApi.list(),
    staleTime: 5 * 60 * 1000,
  });
  const nativeRunnerAvailable =
    serverAdapters?.some(
      (adapter) => adapter.type === "paperclip_runner" && !adapter.disabled,
    ) === true;

  // Fetch existing agents for the "Ask CEO" flow
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && newAgentOpen,
  });

  const ceoAgent = (agents ?? []).find((a) => a.role === "ceo");
  const inviteHistoryQueryKey = queryKeys.access.invites(selectedCompanyId ?? "", "all", 5);

  // Build the adapter grid from the UI registry merged with display metadata.
  // This automatically includes external/plugin adapters.
  const adapterGrid = useMemo(() => {
    const registered = listUIAdapters()
      .filter((a) =>
        isAgentAdapterType(a.type) &&
        (a.type !== "paperclip_runner" || nativeRunnerAvailable) &&
        !disabledTypes.has(a.type) &&
        isVisualAdapterChoice(a.type)
      );

    // Sort: recommended first, then alphabetical
    return registered
      .map((a) => {
        const display = getAdapterDisplay(a.type);
        return {
          value: a.type,
          label: display.label,
          desc: display.description,
          icon: display.icon,
          recommended: display.recommended,
          comingSoon: display.comingSoon,
          disabledLabel: display.disabledLabel,
        };
      })
      .sort((a, b) => {
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [disabledTypes, nativeRunnerAvailable, serverAdapters]);

  function handleAskCeo() {
    closeNewAgent();
    openNewIssue({
      assigneeAgentId: ceoAgent?.id,
      title: "Create a new agent",
      description: `(type in what kind of agent you want here)\n\nPreferred agent identity: ${agentIcon}`,
    });
  }

  function handleAdvancedConfig() {
    setMode("runtime");
  }

  function handleInviteExternalAgent() {
    setMode("invite");
  }

  function handleAdvancedAdapterPick(adapterType: string) {
    closeNewAgent();
    resetDialogState();
    navigate(`/agents/new?adapterType=${encodeURIComponent(adapterType)}&icon=${encodeURIComponent(agentIcon)}`);
  }

  async function copyText(text: string, unavailableBody: string) {
    try {
      await copyTextToClipboard(text);
      return true;
    } catch {
      pushToast({
        title: "Clipboard unavailable",
        body: unavailableBody,
        tone: "warn",
      });
      return false;
    }
  }

  const createAgentInviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(selectedCompanyId!, {
        allowedJoinTypes: "agent",
        humanRole: null,
        agentMessage: agentMessage.trim() || null,
      }),
    onSuccess: async (invite) => {
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const onboardingTextUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;

      let prompt: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        prompt = buildAgentOnboardingPrompt({
          onboardingTextUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null,
        });
      } catch {
        prompt = buildAgentOnboardingPrompt({
          onboardingTextUrl,
          connectionCandidates: null,
          testResolutionUrl: null,
        });
      }

      setLatestAgentPrompt(prompt);
      setLatestAgentPromptCopied(false);
      setMode("prompt");
      const copied = await copyText(prompt, "Copy the agent onboarding prompt manually from the field below.");

      await queryClient.invalidateQueries({ queryKey: inviteHistoryQueryKey });
      pushToast({
        title: "Agent invite created",
        body: copied ? "Agent onboarding prompt ready below and copied to clipboard." : "Agent onboarding prompt ready below.",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create agent invite",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  return (
    <Dialog
      open={newAgentOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetDialogState();
          closeNewAgent();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-(--sz-calc-16) p-0 gap-0 overflow-hidden flex flex-col",
          mode === "invite" || mode === "prompt" ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm text-muted-foreground">Add a new agent</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => {
              resetDialogState();
              closeNewAgent();
            }}
          >
            <span className="text-lg leading-none">&times;</span>
          </Button>
        </div>

        <div className="min-h-0 overflow-y-auto p-6 space-y-6">
          {mode === "choices" ? (
            <>
              <button
                type="button"
                aria-label="Customize agent identity"
                onClick={() => setMode("identity")}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-(--foundation-surface-subtle) p-3 text-left transition-colors hover:bg-accent/50"
              >
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-background">
                  <AgentIcon icon={agentIcon} className="size-11" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Agent identity</span>
                  <span className="block text-xs text-muted-foreground">Shape, color and personality</span>
                </span>
                <span className="text-xs font-medium text-muted-foreground">Customize</span>
              </button>

              <div className="space-y-2">
                <div>
                  <h2 className="text-sm font-medium">How should this agent join?</h2>
                  <p className="text-xs text-muted-foreground">Choose one path. You can change its configuration later.</p>
                </div>
                <Button className="w-full" size="lg" onClick={handleAskCeo}>
                  <Bot className="h-4 w-4 mr-2" />
                  Ask the CEO to create a new agent
                </Button>
                <Button variant="outline" className="w-full" onClick={handleAdvancedConfig}>
                  <Settings2 className="h-4 w-4 mr-2" />
                  Configure a runtime manually
                </Button>
                <Button variant="outline" className="w-full" onClick={handleInviteExternalAgent}>
                  <MailPlus className="h-4 w-4 mr-2" />
                  Invite an external agent
                </Button>
              </div>
            </>
          ) : mode === "identity" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setMode("choices")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <div>
                  <h2 className="text-sm font-medium">Choose an identity</h2>
                  <p className="text-xs text-muted-foreground">This character will represent the agent everywhere.</p>
                </div>
              </div>

              <AgentIdentityStudio value={agentIcon} onChange={setAgentIcon} compact />

              <Button className="w-full" onClick={() => setMode("choices")}>
                Use this identity
              </Button>
            </div>
          ) : mode === "runtime" ? (
            <>
              <div className="space-y-2">
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setMode("choices")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <p className="text-sm text-muted-foreground">
                  Choose the runtime Foundation should start or resume directly.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {adapterGrid.map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-md border border-border p-3 text-xs transition-colors hover:bg-accent/50 relative",
                      opt.comingSoon && "opacity-40 cursor-not-allowed",
                    )}
                    disabled={!!opt.comingSoon}
                    title={opt.comingSoon ? opt.disabledLabel : undefined}
                    onClick={() => {
                      if (!opt.comingSoon) handleAdvancedAdapterPick(opt.value);
                    }}
                  >
                    {opt.recommended && (
                      <Badge variant="ghost" className="absolute -top-1.5 right-1.5 bg-green-500 text-white text-(length:--text-nano) font-semibold px-1.5 leading-none">
                        Recommended
                      </Badge>
                    )}
                    <opt.icon className="h-4 w-4" />
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-muted-foreground text-(length:--text-nano)">
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : mode === "invite" ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setMode("choices")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Invite an external agent</h2>
                  <p className="text-sm text-muted-foreground">
                    Generate a one-time onboarding prompt that any compatible agent can use to request access, wait for approval, and claim its Foundation API key.
                  </p>
                </div>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Optional message for the agent</span>
                <Textarea
                  value={agentMessage}
                  onChange={(event) => setAgentMessage(event.target.value)}
                  className="min-h-24 resize-y"
                  placeholder="Add onboarding context, expected role, or first instructions."
                  maxLength={4000}
                />
              </label>

              <div className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
                Agent invites create a join request first. An organization admin still approves the request before the agent can claim its API key.
              </div>

              <div>
                <Button
                  onClick={() => createAgentInviteMutation.mutate()}
                  disabled={!selectedCompanyId || createAgentInviteMutation.isPending}
                >
                  {createAgentInviteMutation.isPending ? "Generating…" : "Generate onboarding prompt"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setMode("invite")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">Agent onboarding prompt</h2>
                    {latestAgentPromptCopied ? (
                      <div className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </div>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Send this prompt to the external agent that should join this organization.
                  </p>
                </div>
              </div>

              <Textarea
                readOnly
                value={latestAgentPrompt ?? ""}
                className="h-(--sz-24rem) resize-y font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!latestAgentPrompt}
                onClick={async () => {
                  if (!latestAgentPrompt) return;
                  const copied = await copyText(latestAgentPrompt, "Copy the agent onboarding prompt manually from the field above.");
                  setLatestAgentPromptCopied(copied);
                }}
              >
                {latestAgentPromptCopied ? "Copied prompt" : "Copy prompt"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
