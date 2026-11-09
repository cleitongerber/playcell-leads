import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import V2Administration from "@/pages/V2Administration";
import V2Campaigns, { V2CampaignDetail } from "@/pages/V2Campaigns";
import V2Leads from "@/pages/V2Leads";
import { V2SeparatedLeadJourney } from "@/components/v2/V2SeparatedLeadJourney";
import V2FollowUps from "@/pages/V2FollowUps";
import V2Governance from "@/pages/V2Governance";
import V2Importer from "@/pages/V2Importer";
import V2ImportConfiguration from "@/pages/V2ImportConfiguration";
import V2Dashboard from "@/pages/V2Dashboard";
import V2Productivity from "@/pages/V2Productivity";
import V2Reports from "@/pages/V2Reports";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { PwaUpdateNotice } from "./components/PwaUpdateNotice";
import { ThemeProvider } from "./contexts/ThemeContext";
import { V2AppShell } from "./components/v2/V2AppShell";
import { v2RoutePaths } from "./components/v2/v2Navigation";

function Router() {
  return (
    <V2AppShell>
      <Switch>
        <Route path="/" component={V2Administration} />
        <Route
          path={v2RoutePaths.administration}
          component={V2Administration}
        />
        <Route
          path={v2RoutePaths.importSettings}
          component={V2ImportConfiguration}
        />
        <Route path={v2RoutePaths.dashboard} component={V2Dashboard} />
        <Route path={v2RoutePaths.productivity} component={V2Productivity} />
        <Route path={v2RoutePaths.reports} component={V2Reports} />
        <Route path={v2RoutePaths.campaignImports} component={V2Importer} />
        <Route
          path={v2RoutePaths.campaignDetail}
          component={V2CampaignDetail}
        />
        <Route path={v2RoutePaths.campaigns} component={V2Campaigns} />
        <Route
          path={v2RoutePaths.leadDetail}
          component={() => <V2SeparatedLeadJourney />}
        />
        <Route path={v2RoutePaths.leads} component={V2Leads} />
        <Route path={v2RoutePaths.followUps} component={V2FollowUps} />
        <Route path={v2RoutePaths.governance} component={V2Governance} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </V2AppShell>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <PwaUpdateNotice />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
