import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import V2Administration from "@/pages/V2Administration";
import V2Campaigns, { V2CampaignDetail } from "@/pages/V2Campaigns";
import V2Leads, { V2LeadDetail } from "@/pages/V2Leads";
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
import type { ReactNode } from "react";

function V2Route({ children }: { children: ReactNode }) {
  return <V2AppShell>{children}</V2AppShell>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <V2Route><V2Administration /></V2Route>} />
      <Route path="/v2/admin" component={() => <V2Route><V2Administration /></V2Route>} />
      <Route path="/v2/import-settings" component={() => <V2Route><V2ImportConfiguration /></V2Route>} />
      <Route path="/v2/dashboard" component={() => <V2Route><V2Dashboard /></V2Route>} />
      <Route path="/v2/productivity" component={() => <V2Route><V2Productivity /></V2Route>} />
      <Route path="/v2/reports" component={() => <V2Route><V2Reports /></V2Route>} />
      <Route path="/v2/campaigns/:id/imports" component={() => <V2Route><V2Importer /></V2Route>} />
      <Route path="/v2/campaigns/:id" component={() => <V2Route><V2CampaignDetail /></V2Route>} />
      <Route path="/v2/campaigns" component={() => <V2Route><V2Campaigns /></V2Route>} />
      <Route path="/v2/leads/:id" component={() => <V2Route><V2LeadDetail /></V2Route>} />
      <Route path="/v2/leads" component={() => <V2Route><V2Leads /></V2Route>} />
      <Route path="/v2/follow-ups" component={() => <V2Route><V2FollowUps /></V2Route>} />
      <Route path="/v2/governance" component={() => <V2Route><V2Governance /></V2Route>} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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
