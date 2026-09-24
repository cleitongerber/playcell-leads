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
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() {
  return (
    <Switch>
      <Route path="/" component={V2Administration} />
      <Route path="/v2/admin" component={V2Administration} />
      <Route path="/v2/import-settings" component={V2ImportConfiguration} />
      <Route path="/v2/campaigns/:id/imports" component={V2Importer} />
      <Route path="/v2/campaigns/:id" component={V2CampaignDetail} />
      <Route path="/v2/campaigns" component={V2Campaigns} />
      <Route path="/v2/leads/:id" component={V2LeadDetail} />
      <Route path="/v2/leads" component={V2Leads} />
      <Route path="/v2/follow-ups" component={V2FollowUps} />
      <Route path="/v2/governance" component={V2Governance} />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
