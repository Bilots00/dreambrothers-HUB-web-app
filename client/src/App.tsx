import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import MetaAiManager from "./pages/MetaAiManager";
import MissionControl from "./pages/MissionControl";
import MetaInspiration from "./pages/MetaInspiration";
import Campaigns from "./pages/Campaigns";
import AuditAI from "./pages/AuditAI";
import CopyGenerator from "./pages/CopyGenerator";
import Goals from "./pages/Goals";
import ABTesting from "./pages/ABTesting";
import TrackingSetup from "./pages/TrackingSetup";
import AgentLogs from "./pages/AgentLogs";
import AlertsPage from "./pages/AlertsPage";
import ConnectAccount from "./pages/ConnectAccount";
import Home from "./pages/Home";
import GelatoMaker from "./pages/GelatoMaker";
import PodPartners from "./pages/PodPartners";
import SocialMedia from "./pages/SocialMedia";
import AssetsLibrary from "./pages/AssetsLibrary";
import Inspiration from "./pages/Inspiration";
import CustomerCare from "./pages/CustomerCare";
import SocialDrafts from "./pages/SocialDrafts";
import SocialWatchlist from "./pages/SocialWatchlist";
import SeoResearch from "./pages/SeoResearch";
import SeoBlogs from "./pages/SeoBlogs";
import SeoApprovals from "./pages/SeoApprovals";
import ProductMarketFit from "./pages/ProductMarketFit";
import ProductArtistApprovals from "./pages/ProductArtistApprovals";
import ClaudeSessions from "./pages/ClaudeSessions";
import Settings from "./pages/Settings";
import Login from "./pages/Login";

function withLayout(Component: React.ComponentType) {
  return (
    <DashboardLayout>
      <Component />
    </DashboardLayout>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />

      {/* META ADS */}
      <Route path="/dashboard">{withLayout(Dashboard)}</Route>
      <Route path="/ai-manager">{withLayout(MetaAiManager)}</Route>
      <Route path="/mission-control">{withLayout(MissionControl)}</Route>
      <Route path="/meta/inspiration">{withLayout(MetaInspiration)}</Route>
      <Route path="/campaigns">{withLayout(Campaigns)}</Route>
      <Route path="/audit">{withLayout(AuditAI)}</Route>
      <Route path="/copy">{withLayout(CopyGenerator)}</Route>
      <Route path="/goals">{withLayout(Goals)}</Route>
      <Route path="/ab-testing">{withLayout(ABTesting)}</Route>
      <Route path="/tracking">{withLayout(TrackingSetup)}</Route>
      <Route path="/logs">{withLayout(AgentLogs)}</Route>
      <Route path="/alerts">{withLayout(AlertsPage)}</Route>
      <Route path="/connect">{withLayout(ConnectAccount)}</Route>

      {/* SETTINGS */}
      <Route path="/settings">{withLayout(Settings)}</Route>
      <Route path="/settings/brand">{withLayout(Settings)}</Route>

      {/* PRINT ON DEMAND (Gelato + POD Partners) */}
      <Route path="/gelato/market-fit">{withLayout(ProductMarketFit)}</Route>
      <Route path="/gelato/maker">{withLayout(GelatoMaker)}</Route>
      <Route path="/gelato/pod-partners">{withLayout(PodPartners)}</Route>
      <Route path="/gelato/design-approvals">{withLayout(ProductArtistApprovals)}</Route>
      <Route path="/gelato">{() => { window.location.replace("/gelato/maker"); return null; }}</Route>

      {/* SOCIAL MEDIA */}
      <Route path="/social/calendar">{withLayout(SocialMedia)}</Route>
      <Route path="/social/chat">{withLayout(SocialMedia)}</Route>
      <Route path="/social/create">{withLayout(SocialMedia)}</Route>
      <Route path="/social/drafts">{withLayout(SocialDrafts)}</Route>
      <Route path="/social/watchlist">{withLayout(SocialWatchlist)}</Route>
      <Route path="/social">{() => { window.location.replace("/social/calendar"); return null; }}</Route>

      {/* SEO & RESEARCH */}
      <Route path="/seo/research">{withLayout(SeoResearch)}</Route>
      <Route path="/seo/blogs">{withLayout(SeoBlogs)}</Route>
      <Route path="/seo/approvals">{withLayout(SeoApprovals)}</Route>
      <Route path="/seo">{() => { window.location.replace("/seo/research"); return null; }}</Route>

      {/* CLAUDE AI */}
      <Route path="/claude/sessions">{withLayout(ClaudeSessions)}</Route>
      <Route path="/claude">{() => { window.location.replace("/claude/sessions"); return null; }}</Route>

      {/* CUSTOMER CARE */}
      <Route path="/care">{withLayout(CustomerCare)}</Route>
      <Route path="/care/urgent">{withLayout(CustomerCare)}</Route>

      {/* META LIBRARY */}
      <Route path="/meta/library/inspiration">{withLayout(Inspiration)}</Route>
      <Route path="/meta/library/assets">{withLayout(AssetsLibrary)}</Route>
      {/* SOCIAL LIBRARY */}
      <Route path="/social/library/inspiration">{withLayout(Inspiration)}</Route>
      <Route path="/social/library/assets">{withLayout(AssetsLibrary)}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

const SYNC_KEYS = ["assets_library_api_key", "assets_library_folder_id", "db_inspirations", "db_brand", "gelato.savedTemplates", "gelato.creds"];

function CloudSync({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const q = trpc.settings.getAll.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 4000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!q.isFetched && !q.isError) return;
    try {
      const data = (q.data || {}) as Record<string, string>;
      for (const k of SYNC_KEYS) {
        const v = data[k];
        if (v != null && v !== "") localStorage.setItem(k, v);
      }
    } catch {}
    setReady(true);
  }, [q.isFetched, q.isError, q.data]);
  if (!ready) return null;
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" position="top-right" richColors />
          <CloudSync>
            <AppRouter />
          </CloudSync>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
