// @vitest-environment jsdom

import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockHeartbeatsApi = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
}));

const mockAttentionApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockApprovalsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("@/lib/router", () => ({
  NavLink: ({ to, children, className, ...props }: {
    to: string;
    children: ReactNode;
    className?: string | ((state: { isActive: boolean }) => string);
  }) => (
    <a
      href={to}
      className={typeof className === "function" ? className({ isActive: false }) : className}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    openNewIssue: vi.fn(),
  }),
  useDialogActions: () => ({
    openNewIssue: vi.fn(),
    openNewProject: vi.fn(),
    openNewAgent: vi.fn(),
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "PAP", name: "Paperclip" },
  }),
}));

const mockSidebar = vi.hoisted(() => ({
  isMobile: false,
  setSidebarOpen: vi.fn(),
  collapsed: false,
  collapseLocked: false,
  peeking: false,
  toggleCollapsed: vi.fn(),
  setCollapsed: vi.fn(),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => mockSidebar,
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: mockHeartbeatsApi,
}));

vi.mock("../api/attention", () => ({
  attentionApi: mockAttentionApi,
}));

vi.mock("../api/approvals", () => ({
  approvalsApi: mockApprovalsApi,
}));

vi.mock("../api/issues", () => ({
  issuesApi: mockIssuesApi,
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../hooks/useInboxBadge", () => ({
  useInboxBadge: () => ({ inbox: 0, failedRuns: 0 }),
}));

vi.mock("@/plugins/slots", () => ({
  PluginSlotOutlet: ({ slotTypes }: { slotTypes: string[] }) => (
    <div data-plugin-slot-types={slotTypes.join(",")}>Plugin slot outlet</div>
  ),
}));

vi.mock("@/plugins/launchers", () => ({
  PluginLauncherOutlet: ({ placementZones }: { placementZones: string[] }) => (
    <div data-plugin-launcher-zone={placementZones.join(",")}>Plugin launcher outlet</div>
  ),
}));

vi.mock("./SidebarCompanyMenu", () => ({
  SidebarCompanyMenu: () => <div>Company menu</div>,
}));

vi.mock("./SidebarRecentTasks", () => ({
  SidebarRecentTasks: () => <div data-testid="sidebar-recent-tasks">Recent Tasks</div>,
}));

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

/**
 * Foundation navigation contract.
 *
 * The primary group is capped at five rows and leads with acceptance. Every
 * other capability upstream put at the top level still exists, but lives in
 * the collapsed "Más" section — so these tests assert both halves: the short
 * default surface, and that nothing was actually removed.
 */
describe("Sidebar", () => {
  let container: HTMLDivElement;

  async function renderSidebar() {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Sidebar />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    return root;
  }

  /** "Más" is collapsed by default, so secondary items are not mounted until opened. */
  async function expandSecondaryNav() {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Más"]');
    expect(trigger).not.toBeNull();
    flushSync(() => {
      trigger!.click();
    });
    await flushReact();
  }

  /** The define-work button only carries an aria-label in the collapsed rail. */
  function defineWorkButton(scope: ParentNode = container) {
    return [...scope.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Definir trabajo") ?? null;
  }

  function navLabels(scope: ParentNode = container) {
    return [...scope.querySelectorAll("nav a")].map((anchor) => anchor.textContent?.trim());
  }

  function primaryNav() {
    return container.querySelector('[data-testid="foundation-primary-nav"]');
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
    mockAttentionApi.list.mockResolvedValue({ items: [] });
    mockApprovalsApi.list.mockResolvedValue([]);
    mockIssuesApi.list.mockResolvedValue([]);
    mockSidebar.isMobile = false;
    mockSidebar.collapsed = false;
    mockSidebar.collapseLocked = false;
    mockSidebar.peeking = false;
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps the default sidebar edge borderless", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    const sidebar = container.querySelector("aside");
    expect(sidebar?.classList).not.toContain("border-r");
    expect(sidebar?.classList).not.toContain("border-border");
    expect(sidebar?.classList).toContain("foundation-sidebar");

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps tasks, projects, agents, and human members in one compact navigation group", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    const primary = primaryNav();
    const rows = [...(primary?.querySelectorAll("a") ?? [])];
    expect(rows.map((anchor) => anchor.textContent?.trim())).toEqual([
      "Inbox",
      "Proyectos",
      "Tareas",
      "Agentes",
      "Miembros",
    ]);
    expect(rows.map((anchor) => anchor.getAttribute("href"))).toEqual([
      "/inbox",
      "/projects",
      "/issues",
      "/agents",
      "/company/settings/members",
    ]);
    expect(rows[1]?.querySelector("svg")?.classList).toContain("lucide-box");
    expect(rows[2]?.querySelector("svg")?.classList).toContain("lucide-circle-dot");
    expect(rows[3]?.querySelector("svg")?.classList).toContain("lucide-bot");
    expect(rows[4]?.querySelector("svg")?.classList).toContain("lucide-users");

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps the ops cockpit out of the default surface", async () => {
    // The lock: no dashboard, no spend, no charts, and no "define work" hero
    // competing with the accept action.
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    const primaryText = primaryNav()?.textContent ?? "";
    expect(primaryText).not.toContain("Panel");
    expect(primaryText).not.toContain("Costos");
    expect(primaryText).not.toContain("Actividad");
    expect(primaryText).not.toContain("Empresa");
    expect(primaryText).not.toContain("Definir");
    // Upstream's hero button is gone from the default surface entirely.
    expect(defineWorkButton(primaryNav()!)).toBeNull();
    expect(defineWorkButton()).toBeNull();
    expect(container.textContent).not.toContain("Definir Work");

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not mount secondary navigation until Más is expanded", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    expect(navLabels()).not.toContain("Entregables");
    expect(container.textContent).toContain("Más");

    await expandSecondaryNav();
    expect(navLabels()).toContain("Entregables");

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps every secondary capability routable, just not primary", async () => {
    // Hiding noise must not delete capabilities — this is the regression guard
    // for that rule.
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const hrefFor = (label: string) =>
      [...container.querySelectorAll("nav a")]
        .find((anchor) => anchor.textContent?.trim() === label)
        ?.getAttribute("href");

    expect(hrefFor("Inbox")).toBe("/inbox");
    expect(hrefFor("Proyectos")).toBe("/projects");
    expect(hrefFor("Entregables")).toBe("/artifacts");
    expect([...container.querySelectorAll('a[href="/search"]')]).toHaveLength(1);
    expect(hrefFor("Rutinas")).toBe("/routines");
    expect(hrefFor("Habilidades")).toBe("/skills");
    expect(hrefFor("Conexiones")).toBe("/apps");
    expect(hrefFor("Actividad")).toBe("/activity");
    expect(hrefFor("Costos")).toBe("/costs");
    expect(hrefFor("Panel")).toBe("/dashboard");
    expect(hrefFor("Empresa")).toBe("/company/settings");
    expect(defineWorkButton()).not.toBeNull();

    flushSync(() => {
      root.unmount();
    });
  });

  it("exposes exactly one Agents destination", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();
    await expandSecondaryNav();

    expect([...container.querySelectorAll('a[href="/agents"]')]).toHaveLength(1);
    expect([...container.querySelectorAll('a[href="/activity"]')]).toHaveLength(1);
    expect(navLabels()).not.toContain("Equipo");
    expect(navLabels()).not.toContain("Issues");

    flushSync(() => {
      root.unmount();
    });
  });

  it("has no streamlined/legacy navigation fork left", async () => {
    // PAP-12472 retired the opt-out upstream; Foundation removed the branch
    // outright, so a stale `false` setting cannot resurrect a second nav.
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableStreamlinedUi: false,
      enableStreamlinedLeftNavigation: false,
    });
    const root = await renderSidebar();

    expect(primaryNav()?.querySelectorAll("a")).toHaveLength(5);
    expect(container.textContent).not.toContain("Organización");
    expect(container.textContent).not.toContain("Operación");
    expect(container.querySelector('[data-testid="sidebar-projects"]')).toBeNull();
    expect(container.querySelector('[data-testid="sidebar-agents"]')).toBeNull();
    expect(container.querySelector('[data-testid="sidebar-recent-tasks"]')).not.toBeNull();

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows Search once as a compact header action", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const searchLinks = [...container.querySelectorAll('a[href="/search"]')];
    expect(searchLinks).toHaveLength(1);
    expect(searchLinks[0]?.closest('[data-testid="foundation-primary-nav"]')).toBeNull();

    flushSync(() => {
      root.unmount();
    });
  });

  it("renders plugin sidebar launchers inside the Más section", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const launcher = [...container.querySelectorAll("nav [data-plugin-launcher-zone]")]
      .find((node) => node.getAttribute("data-plugin-launcher-zone") === "sidebar");
    expect(launcher?.textContent).toContain("Plugin launcher outlet");
    expect(primaryNav()?.textContent).not.toContain("Plugin launcher outlet");

    flushSync(() => {
      root.unmount();
    });
  });

  it("renders plugin sidebar slots in Más below Workspaces", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: true });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const sidebarSlot = [...container.querySelectorAll("nav [data-plugin-slot-types]")]
      .find((node) => node.getAttribute("data-plugin-slot-types") === "sidebar");
    expect(sidebarSlot?.textContent).toContain("Plugin slot outlet");

    const navText = container.querySelector("nav")?.textContent ?? "";
    expect(navText).toContain("Workspaces");
    expect(navText.indexOf("Workspaces")).toBeLessThan(navText.indexOf("Plugin slot outlet"));
    expect(primaryNav()?.textContent).not.toContain("Plugin slot outlet");

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not flash the Workspaces link while experimental settings are loading", async () => {
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const root = await renderSidebar();

    expect(container.textContent).not.toContain("Workspaces");

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows the Workspaces link when isolated workspaces are enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: true });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const link = [...container.querySelectorAll("a")].find((anchor) => anchor.textContent === "Workspaces");
    expect(link?.getAttribute("href")).toBe("/workspaces");

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not poll attention until Decisions is enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableDecisions: false });
    const root = await renderSidebar();

    expect(mockAttentionApi.list).not.toHaveBeenCalled();

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps Decisions and Status out of the primary navigation when enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableDecisions: true,
      enableStatusCards: true,
    });
    const root = await renderSidebar();

    expect(primaryNav()?.querySelectorAll("a")).toHaveLength(5);
    expect(primaryNav()?.textContent).not.toContain("Decisions");
    expect(primaryNav()?.textContent).not.toContain("Status");

    await expandSecondaryNav();
    const statusLink = [...container.querySelectorAll("nav a")]
      .find((anchor) => anchor.getAttribute("href") === "/status");
    expect(statusLink?.textContent).toContain("Status");
    expect(statusLink?.textContent).toContain("beta");
    expect(
      [...container.querySelectorAll("nav a")].some((a) => a.getAttribute("href") === "/decisions"),
    ).toBe(true);

    flushSync(() => {
      root.unmount();
    });
  });

  it("hides the Goals nav item by default", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enableGoalsSidebarLink: false,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    expect(navLabels()).not.toContain("Goals");

    flushSync(() => {
      root.unmount();
    });
  });

  it("reserves no nav slot for Goals while experimental settings are loading", async () => {
    // The placeholder upstream needed is unnecessary now: Goals lives inside a
    // collapsed section, so a late-arriving flag cannot shift the surface.
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const root = await renderSidebar();

    expect(navLabels()).not.toContain("Goals");
    expect(container.querySelector('[data-testid="sidebar-goals-placeholder"]')).toBeNull();
    expect(primaryNav()?.querySelectorAll("a")).toHaveLength(5);

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows the Goals nav item when the experimental setting is enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enableGoalsSidebarLink: true,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const link = [...container.querySelectorAll("a")].find((anchor) => anchor.textContent === "Goals");
    expect(link?.getAttribute("href")).toBe("/goals");
    expect(primaryNav()?.textContent).not.toContain("Goals");

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps Timeline out of the navigation entirely", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();
    await expandSecondaryNav();

    expect(container.querySelector('a[href="/timeline"]')).toBeNull();
    expect(navLabels()).not.toContain("Cronología");

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows the Conference Room nav item when conference room chat is enabled (PAP-137)", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enableConferenceRoomChat: true,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const link = [...container.querySelectorAll("nav a")].find(
      (anchor) => anchor.textContent?.trim() === "Conference Room",
    );
    expect(link?.getAttribute("href")).toBe("/board-chat");
    expect(primaryNav()?.textContent).not.toContain("Conference Room");

    flushSync(() => {
      root.unmount();
    });
  });

  it("hides the Conference Room nav item when conference room chat is off (PAP-137)", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enableConferenceRoomChat: false,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    expect(container.textContent).not.toContain("Conference Room");

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not flash the Conference Room item while experimental settings are loading (PAP-137)", async () => {
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const root = await renderSidebar();

    expect(container.textContent).not.toContain("Conference Room");

    flushSync(() => {
      root.unmount();
    });
  });

  it("hides the Pipelines nav item when pipelines are disabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enablePipelines: false,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    expect(container.textContent).not.toContain("Pipelines");

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows the Pipelines nav item when pipelines are enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enablePipelines: true,
    });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const link = [...container.querySelectorAll("a")].find((anchor) => anchor.textContent === "Pipelines");
    expect(link?.getAttribute("href")).toBe("/pipelines");

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not flash the Pipelines nav item while experimental settings are loading", async () => {
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const root = await renderSidebar();

    expect(container.textContent).not.toContain("Pipelines");

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps Connectors in the Más section with its icon", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableApps: false });
    const root = await renderSidebar();
    await expandSecondaryNav();

    const links = [...container.querySelectorAll("a")];
    const link = links.find((anchor) => anchor.textContent === "Conexiones");
    expect(link?.getAttribute("href")).toBe("/apps");
    expect(link?.querySelector("svg")?.classList).toContain("lucide-unplug");
    expect(links.findIndex((anchor) => anchor.textContent === "Conexiones")).toBeGreaterThan(
      links.findIndex((anchor) => anchor.textContent === "Habilidades"),
    );
    expect(links.findIndex((anchor) => anchor.textContent === "Conexiones")).toBeLessThan(
      links.findIndex((anchor) => anchor.textContent === "Actividad"),
    );

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not duplicate task review as a separate primary module", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    expect(container.querySelector('nav a[href="/approvals"]')).toBeNull();
    expect(container.querySelector('nav a[href="/issues"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Por aprobar");

    flushSync(() => {
      root.unmount();
    });
  });

  it("does not render a global navigation collapse affordance", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    expect(container.querySelector('button[aria-label="Collapse sidebar"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Expand sidebar"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Keep sidebar expanded"]')).toBeNull();
    expect(container.textContent).toContain("Company menu");

    flushSync(() => {
      root.unmount();
    });
  });

  it("hides the collapse affordance on mobile (drawer handles it)", async () => {
    mockSidebar.isMobile = true;
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    expect(container.querySelector('button[aria-label="Collapse sidebar"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Keep sidebar expanded"]')).toBeNull();

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps the collapse control absent while a secondary sidebar forces the rail", async () => {
    mockSidebar.collapseLocked = true;
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    const root = await renderSidebar();

    expect(container.querySelector('button[aria-label="Collapse sidebar"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Expand sidebar"]')).toBeNull();

    flushSync(() => {
      root.unmount();
    });
  });
});
