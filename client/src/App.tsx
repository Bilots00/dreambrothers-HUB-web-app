import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
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
import SocialMedia from "./pages/SocialMedia";
import AssetsLibrary from "./pages/AssetsLibrary";
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
      <Route path="/campaigns">{withLayout(Campaigns)}</Route>
      <Route path="/audit">{withLayout(AuditAI)}</Route>
      <Route path="/copy">{withLayout(CopyGenerator)}</Route>
      <Route path="/goals">{withLayout(Goals)}</Route>
      <Route path="/ab-testing">{withLayout(ABTesting)}</Route>
      <Route path="/tracking">{withLayout(TrackingSetup)}</Route>
      <Route path="/logs">{withLayout(AgentLogs)}</Route>
      <Route path="/alerts">{withLayout(AlertsPage)}</Route>
      <Route path="/connect">{withLayout(ConnectAccount)}</Route>

      {/* GELATO */}
      <Route path="/gelato/maker">{withLayout(GelatoMaker)}</Route>
      <Route path="/gelato">{() => { window.location.replace("/gelato/maker"); return null; }}</Route>

      {/* SOCIAL MEDIA */}
      <Route path="/social/calendar">{withLayout(SocialMedia)}</Route>
      <Route path="/social/chat">{withLayout(SocialMedia)}</Route>
      <Route path="/social/create">{withLayout(SocialMedia)}</Route>
      <Route path="/social">{() => { window.location.replace("/social/calendar"); return null; }}</Route>

      {/* META LIBRARY */}
      <Route path="/meta/library/assets">{withLayout(AssetsLibrary)}</Route>
      {/* SOCIAL LIBRARY */}
      <Route path="/social/library/assets">{withLayout(AssetsLibrary)}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" position="top-right" richColors />
          <AppRouter />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
