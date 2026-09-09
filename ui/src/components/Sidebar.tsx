import {
  Inbox,
  ListChecks,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Boxes,
  Repeat,
  Layers,
  GitBranch,
  Package,
  Settings,
  FolderOpen,
  Unplug,
  MessagesSquare,
  LayoutGrid,
  Users,
  Box,
  Bot,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarRecentTasks } from "./SidebarRecentTasks";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { attentionApi } from "../api/attention";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { attentionBadgeCount } from "../lib/attention";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, SIDEBAR_RAIL_HIDDEN_LABEL } from "../lib/utils";
import { PluginSlotOutlet } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { SidebarCompanyMenu } from "./SidebarCompanyMenu";
import { primarySidebarStyles } from "./primary-sidebar-styles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Foundation navigation contract (supersedes the upstream Foundation nav).
 *
 * The primary group is capped at five rows and mirrors the product model:
 * review is a task state, not a separate destination. Everything
 * else upstream surfaced at the top level — the dashboard, spend, activity,
 * skills, connections, company settings, and every experimental surface —
 * still exists and stays routable, but it lives in the collapsed "Más"
 * section so the default chrome does not read as an ops cockpit.
 *
 * Capabilities are hidden here, never removed: no route is deleted by this
 * component.
 */
export function Sidebar() {
  const { openNewIssue, openNewProject, openNewAgent } = useDialogActions();
  // Secondary nav is collapsed by default — that default is the whole point of
  // the section, so it is not merely a remembered preference.
  const [moreOpen, setMoreOpen] = useState(false);
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { collapsed, peeking } = useSidebar();
  const rail = collapsed && !peeking;
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const liveRunsQueryKey = queryKeys.liveRuns(selectedCompanyId!);
  const sharedLiveRuns = useSharedPollingQuery({
    companyId: selectedCompanyId,
    resourceKey: "live-runs",
    queryKey: liveRunsQueryKey,
    enabled: !!selectedCompanyId,
    // Event-sourced via LiveUpdatesProvider (GitHub issue 9627) + reconnect reconcile — no
    // interval poll needed. Polling here also re-armed React Query's timer on
    // every live-event cache write, a major source of steady-state churn.
    refetchInterval: false,
    leaderOnly: true,
  });
  const { data: liveRuns, dataUpdatedAt: liveRunsUpdatedAt } = useQuery({
    queryKey: liveRunsQueryKey,
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: sharedLiveRuns.enabled,
    refetchInterval: sharedLiveRuns.refetchInterval,
  });
  usePublishSharedQueryData(sharedLiveRuns, liveRuns, liveRunsUpdatedAt);
  const liveIssueIds = new Set(
    (liveRuns ?? []).flatMap((run) => run.issueId ? [run.issueId] : []),
  );

  const showWorkspacesLink = experimentalSettings?.enableIsolatedWorkspaces === true;
  const showPipelines = experimentalSettings?.enablePipelines === true;
  const showStatusCards = experimentalSettings?.enableStatusCards === true;
  const showGoalsLink = experimentalSettings?.enableGoalsSidebarLink === true;
  // Decisions (attention home) is an experimental surface (PAP-13481): the nav
  // item is hidden entirely until the flag is enabled (same no-flash pattern as
  // showWorkspacesLink — it defaults hidden, so no placeholder is needed).
  const showDecisions = experimentalSettings?.enableDecisions === true;
  const { data: attentionFeed } = useQuery({
    queryKey: queryKeys.attention(selectedCompanyId!),
    queryFn: () => attentionApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && showDecisions,
    refetchInterval: 60_000,
  });
  const attentionCount = attentionBadgeCount(attentionFeed);
  const showCases = experimentalSettings?.enableCases === true;
  // Conference Room Chat flag (PAP-136/PAP-137): the Conference Room nav item
  // is a new surface, hidden entirely while the flag is off (same no-flash
  // pattern as showWorkspacesLink above).
  const conferenceRoomChatEnabled = experimentalSettings?.enableConferenceRoomChat === true;

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  const defineWorkButton = (
    <button
      onClick={() => openNewIssue()}
      data-slot="icon-button"
      aria-label={rail ? "Definir trabajo" : undefined}
      className={cn(
        "flex min-h-(--foundation-nav-height) items-center gap-2 rounded-(--foundation-control-radius) px-2.5 py-0.5 pointer-coarse:min-h-11 text-xs font-normal text-foreground/72 transition-[background-color,color,opacity] duration-(--motion-duration-exit) ease-(--motion-ease-out) hover:bg-(--foundation-sidebar-hover) hover:text-foreground",
      )}
    >
      <SquarePen className="size-3.5 shrink-0" strokeWidth={1.7} />
      <span className={rail ? SIDEBAR_RAIL_HIDDEN_LABEL : "truncate"}>Definir trabajo</span>
    </button>
  );

  return (
    <aside
      className={cn(
        "w-full h-full min-h-0 flex flex-col",
        primarySidebarStyles.surface,
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <SidebarCompanyMenu />
        {!rail ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <SidebarNavItem
              to="/search"
              label="Buscar"
              icon={Search}
              className="size-7 min-h-7 justify-center gap-0 px-0 py-0"
              labelClassName="sr-only"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Crear"
                  className="flex size-7 items-center justify-center rounded-full bg-(--foundation-sidebar-selected) text-foreground/80 transition-[background-color,color,transform] duration-(--motion-duration-exit) ease-(--motion-ease-out) hover:scale-[1.03] hover:bg-foreground/15 hover:text-foreground active:scale-[0.97]"
                >
                  <SquarePen className="size-3.5" strokeWidth={1.7} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-52">
                <DropdownMenuItem onSelect={openNewProject}>
                  <Box /> Proyecto
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openNewIssue()}>
                  <CircleDot /> Tarea
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openNewAgent}>
                  <Bot /> Agente de IA
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      <nav className={primarySidebarStyles.nav}>
        <div data-testid="foundation-primary-nav" className={primarySidebarStyles.group}>
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeLabel="sin leer"
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
          <SidebarNavItem to="/projects" label="Proyectos" icon={Box} />
          <SidebarNavItem to="/issues" label="Tareas" icon={CircleDot} />
          <SidebarNavItem to="/agents" label="Agentes" icon={Bot} />
          <SidebarNavItem to="/assurance" label="Assurance" icon={ShieldCheck} />
        </div>

        <SidebarSection label="Más" collapsible={{ open: moreOpen, onOpenChange: setMoreOpen }}>
          <SidebarNavItem to="/company/settings/members" label="Miembros" icon={Users} />
          {rail ? (
            <Tooltip>
              <TooltipTrigger asChild>{defineWorkButton}</TooltipTrigger>
              <TooltipContent side="right">Definir trabajo</TooltipContent>
            </Tooltip>
          ) : (
            defineWorkButton
          )}
          <SidebarNavItem to="/artifacts" label="Entregables" icon={Package} />
          <SidebarNavItem to="/routines" label="Rutinas" icon={Repeat} />
          <SidebarNavItem to="/skills" label="Habilidades" icon={Boxes} />
          <SidebarNavItem to="/apps" label="Conexiones" icon={Unplug} />
          <SidebarNavItem to="/activity" label="Actividad" icon={History} />
          <SidebarNavItem to="/costs" label="Costos" icon={DollarSign} />
          <SidebarNavItem to="/dashboard" label="Panel" icon={LayoutDashboard} />
          <SidebarNavItem to="/company/settings" label="Empresa" icon={Settings} />
          {showDecisions ? (
            <SidebarNavItem
              to="/decisions"
              label="Decisions"
              icon={ListChecks}
              badge={attentionCount}
              badgeLabel="decisions"
            />
          ) : null}
          {showStatusCards ? (
            <SidebarNavItem to="/status" label="Status" icon={LayoutGrid} textBadge="beta" />
          ) : null}
          {conferenceRoomChatEnabled ? (
            <SidebarNavItem to="/board-chat" label="Conference Room" icon={MessagesSquare} />
          ) : null}
          {showCases ? (
            <SidebarNavItem to="/cases" label="Cases" icon={Layers} textBadge="beta" />
          ) : null}
          {showPipelines ? (
            <SidebarNavItem to="/pipelines" label="Pipelines" icon={GitBranch} />
          ) : null}
          {showGoalsLink ? (
            <SidebarNavItem to="/goals" label="Goals" icon={Target} />
          ) : null}
          {showWorkspacesLink ? (
            <SidebarNavItem to="/workspaces" label="Workspaces" icon={GitBranch} />
          ) : null}
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-(length:--text-compact) font-medium"
            missingBehavior="placeholder"
          />
          <PluginLauncherOutlet
            placementZones={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-(length:--text-compact) font-medium"
          />
        </SidebarSection>

        <SidebarRecentTasks companyId={selectedCompanyId} liveIssueIds={liveIssueIds} />

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
