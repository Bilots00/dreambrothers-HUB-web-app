import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Activity, AlertTriangle, BarChart3, Bell, Bot, Maximize,
  ChevronDown, FlaskConical, Instagram, Layout,
  LogOut, Megaphone, Package, Package2, PanelLeft, Plug,
  Sparkles, Target, Zap, MessageSquare, Calendar, PenSquare,
  Library, Images, Lightbulb, Settings as SettingsIcon, ClipboardList, Headset, Inbox, Radar,
  Newspaper, TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

// ─── Nav Config ───────────────────────────────────────────────────────────────
const META_ADS_ITEMS = [
  { icon: BarChart3, label: "Dashboard", path: "/dashboard", description: "KPI & Performance" },
  { icon: Megaphone, label: "Campagne", path: "/campaigns", description: "Gestione campagne META" },
  { icon: Target, label: "Obiettivi AI", path: "/goals", description: "Goal-based agent" },
  { icon: Sparkles, label: "Audit AI", path: "/audit", description: "Analisi account" },
  { icon: Bot, label: "Copy Generator", path: "/copy", description: "Testi pubblicitari AI" },
  { icon: FlaskConical, label: "A/B Testing", path: "/ab-testing", description: "Test varianti" },
  { icon: Zap, label: "Tracking", path: "/tracking", description: "Pixel & CAPI" },
  { icon: Activity, label: "Log Agente", path: "/logs", description: "Azioni autonome AI" },
  { icon: AlertTriangle, label: "Alert", path: "/alerts", description: "Anomalie & Recovery" },
  { icon: Plug, label: "Connetti Account", path: "/connect", description: "META Business" },
];

const GELATO_ITEMS = [
  { icon: Radar, label: "Product Market FIT", path: "/gelato/market-fit", description: "Monitor competitor & opportunità" },
  { icon: Package2, label: "Bulk Creator", path: "/gelato/maker", description: "Crea prodotti in massa" },
  { icon: Package, label: "POD Partners", path: "/gelato/pod-partners", description: "Fornitori & certificato" },
];

const SOCIAL_ITEMS = [
  { icon: MessageSquare, label: "AI Manager", path: "/social/chat", description: "Il tuo SMMA AI" },
  { icon: PenSquare, label: "Crea Post", path: "/social/create", description: "Organic Contents LAB" },
  { icon: Calendar, label: "Calendario", path: "/social/calendar", description: "Piano mensile & annuale" },
  { icon: ClipboardList, label: "Bozze", path: "/social/drafts", description: "Bozze da revisionare" },
  { icon: Radar, label: "Watchlist", path: "/social/watchlist", description: "Canali competitor & outlier" },
];

const SEO_ITEMS = [
  { icon: Newspaper, label: "Research Hub", path: "/seo/research", description: "Trend, news & keywords" },
];

const CARE_ITEMS = [
  { icon: Inbox, label: "Inbox", path: "/care", description: "Tutti i messaggi clienti" },
];

const LIBRARY_ITEMS = [
  { icon: Lightbulb, label: "Inspiration", path: "/meta/library/inspiration", description: "Riferimenti & remix" },
  { icon: Images, label: "My Assets", path: "/meta/library/assets", description: "Creative generate (n8n / Drive)" },
];

// Flat map for header lookup
const ALL_ITEMS = [...META_ADS_ITEMS, ...GELATO_ITEMS, ...SOCIAL_ITEMS, ...SEO_ITEMS, ...CARE_ITEMS, ...LIBRARY_ITEMS];

// ─── NavGroup component ───────────────────────────────────────────────────────
function NavGroup({
  label, icon: GroupIcon, color, items, location, navigate,
  sidebarOpen, badges, defaultOpen, alerts,
}: {
  label: string;
  icon: React.ElementType;
  color: string;
  items: typeof META_ADS_ITEMS;
  location: string;
  navigate: (path: string) => void;
  sidebarOpen: boolean;
  badges?: Record<string, number>;
  defaultOpen?: boolean;
  alerts?: number;
}) {
  const isGroupActive = items.some((item) => location === item.path || (item.path !== "/dashboard" && location.startsWith(item.path)));
  const [open, setOpen] = useState(defaultOpen ?? isGroupActive);

  return (
    <div className="space-y-0.5">
      {/* Group header */}
      {sidebarOpen ? (
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all hover:bg-accent"
          style={{ color: isGroupActive ? color : "oklch(0.5 0.02 260)" }}
        >
          <GroupIcon className="w-4 h-4 shrink-0" style={{ color }} />
          <span className="text-xs font-semibold uppercase tracking-wider flex-1">{label}</span>
          <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
        </button>
      ) : (
        <div className="h-px mx-2 my-1" style={{ background: "oklch(0.2 0.015 260)" }} />
      )}

      {/* Items */}
      {(open || !sidebarOpen) && (
        <div className={sidebarOpen ? "space-y-0.5 pl-1" : "space-y-0.5"}>
          {items.map((item) => {
            const isActive = location === item.path || (item.path !== "/dashboard" && location.startsWith(item.path));
            const Icon = item.icon;
            const badgeCount = badges?.[item.path] ?? 0;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${isActive ? "sidebar-item-active" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
              >
                <span className="relative shrink-0 flex items-center justify-center">
                  <Icon className={`${isActive ? "text-primary" : ""}`} style={{ width: 17, height: 17 }} />
                  {!sidebarOpen && badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full text-[9px] font-bold leading-none" style={{ minWidth: 14, height: 14, padding: "0 3px", background: "oklch(0.55 0.22 25)", color: "white" }}>{badgeCount > 9 ? "9+" : badgeCount}</span>
                  )}
                </span>
                {sidebarOpen && (
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{item.label}</span>
                      {badgeCount > 0 && (
                        <Badge className="text-xs px-1.5 py-0 h-4 ml-1" style={{ background: "oklch(0.55 0.22 25)", color: "white", border: "none" }}>
                          {badgeCount}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Layout ──────────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data: dashboard } = trpc.kpi.getDashboard.useQuery({ days: 30 }, { enabled: !!user, refetchInterval: 60000 });
  const { data: alerts } = trpc.alerts.list.useQuery({ onlyUnread: true }, { enabled: !!user, refetchInterval: 30000 });
  const unreadCount = alerts?.length ?? 0;
  const { data: careConvos } = trpc.customerCare.list.useQuery(undefined, { enabled: !!user, refetchInterval: 30000 });
  const careUnread = (careConvos ?? []).filter((c) => c.unread).length;

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "oklch(0.1 0.01 260)" }}>
        <div className="text-center max-w-md px-8">
          <div className="mb-8">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: "var(--gradient-primary)" }}>
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-3">DreamBrothers Hub</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Il tuo centro di controllo unificato per META Ads, Gelato Print Studio e Social Media Organico.
            </p>
          </div>
          <Button onClick={() => { window.location.href = getLoginUrl(); }} size="lg" className="w-full font-semibold" style={{ background: "var(--gradient-primary)" }}>
            Accedi alla piattaforma
          </Button>
        </div>
      </div>
    );
  }

  const activeGoals = dashboard?.activeGoals ?? 0;
  const currentItem = ALL_ITEMS.find((i) => i.path === location || (i.path !== "/dashboard" && location.startsWith(i.path)));

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "oklch(0.1 0.01 260)" }}>
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className="flex flex-col transition-all duration-300 ease-out shrink-0"
        style={{ width: sidebarOpen ? "260px" : "72px", background: "oklch(0.12 0.015 260)", borderRight: "1px solid oklch(0.2 0.015 260)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 shrink-0" style={{ borderBottom: "1px solid oklch(0.2 0.015 260)" }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--gradient-primary)" }}>
            <Layout className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="font-bold text-sm text-foreground whitespace-nowrap">DreamBrothers</div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">Hub Centrale</div>
            </div>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Agent Status */}
        {sidebarOpen && activeGoals > 0 && (
          <div className="mx-3 mt-3 p-3 rounded-xl" style={{ background: "oklch(0.65 0.2 265 / 0.1)", border: "1px solid oklch(0.65 0.2 265 / 0.2)" }}>
            <div className="flex items-center gap-2">
              <div className="pulse-dot pulse-dot-running" />
              <span className="text-xs font-medium" style={{ color: "oklch(0.75 0.15 265)" }}>
                Agente attivo — {activeGoals} obiettiv{activeGoals === 1 ? "o" : "i"}
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-3">
          {/* META ADS */}
          <NavGroup
            label="META Ads"
            icon={Megaphone}
            color="oklch(0.65 0.2 265)"
            items={META_ADS_ITEMS}
            location={location}
            navigate={navigate}
            sidebarOpen={sidebarOpen}
            badges={{ "/alerts": unreadCount }}
            defaultOpen={true}
          />

          {/* Print on Demand (Gelato + POD Partners) */}
          <NavGroup
            label="Print on Demand"
            icon={Package2}
            color="oklch(0.65 0.2 310)"
            items={GELATO_ITEMS}
            location={location}
            navigate={navigate}
            sidebarOpen={sidebarOpen}
            defaultOpen={false}
          />

          {/* Social Media */}
          <NavGroup
            label="Social Organico"
            icon={Instagram}
            color="oklch(0.65 0.2 340)"
            items={SOCIAL_ITEMS}
            location={location}
            navigate={navigate}
            sidebarOpen={sidebarOpen}
            defaultOpen={false}
          />

          {/* SEO & Research */}
          <NavGroup
            label="SEO & Research"
            icon={TrendingUp}
            color="oklch(0.74 0.12 195)"
            items={SEO_ITEMS}
            location={location}
            navigate={navigate}
            sidebarOpen={sidebarOpen}
            defaultOpen={false}
          />

          {/* Customer Care */}
          <NavGroup
            label="Customer Care"
            icon={Headset}
            color="oklch(0.6 0.18 145)"
            items={CARE_ITEMS}
            location={location}
            navigate={navigate}
            sidebarOpen={sidebarOpen}
            badges={{ "/care": careUnread }}
            defaultOpen={false}
          />

          {/* Library */}
          <NavGroup
            label="Library"
            icon={Library}
            color="oklch(0.72 0.18 75)"
            items={LIBRARY_ITEMS}
            location={location}
            navigate={navigate}
            sidebarOpen={sidebarOpen}
            defaultOpen={false}
          />
        </nav>

        {/* User Footer */}
        <div className="shrink-0 p-3" style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
          <div className={`flex items-center gap-3 ${sidebarOpen ? "px-2 py-2" : "justify-center py-2"}`}>
            <Avatar className="w-8 h-8 shrink-0">
              <AvatarFallback style={{ background: "var(--gradient-primary)", color: "white", fontSize: "12px", fontWeight: "600" }}>
                {user.name?.charAt(0)?.toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <>
                <div className="flex-1 overflow-hidden">
                  <div className="text-sm font-medium truncate">{user.name ?? "Utente"}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email ?? ""}</div>
                </div>
                <button onClick={() => navigate("/settings")} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Impostazioni">
                  <SettingsIcon className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="shrink-0 flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid oklch(0.2 0.015 260)", background: "oklch(0.12 0.015 260 / 0.8)", backdropFilter: "blur(12px)" }}>
          <div>
            {currentItem && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">{currentItem.label}</h1>
                <p className="text-xs text-muted-foreground">{currentItem.description}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {activeGoals > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium agent-running-indicator" style={{ background: "oklch(0.65 0.2 265 / 0.1)", border: "1px solid oklch(0.65 0.2 265 / 0.3)", color: "oklch(0.75 0.15 265)" }}>
                <div className="pulse-dot pulse-dot-running" />
                Agente META in esecuzione
              </div>
            )}
            <button onClick={() => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen?.(); } else { document.exitFullscreen?.(); } }} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Schermo intero (focus mode)">
              <Maximize className="w-5 h-5" />
            </button>
            <button onClick={() => navigate("/alerts")} className="relative p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold" style={{ background: "oklch(0.55 0.22 25)", color: "white" }}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
