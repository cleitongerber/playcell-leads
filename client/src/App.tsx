import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Leads from "@/pages/Leads";
import ImportLeads from "@/pages/ImportLeads";
import Team from "@/pages/Team";
import Reports from "@/pages/Reports";
import Pdvs from "@/pages/Pdvs";
import Audit from "@/pages/Audit";
import Campaigns from "@/pages/Campaigns";
import FollowUps from "@/pages/FollowUps";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/leads" component={Leads} />
    <Route path="/follow-ups" component={FollowUps} />
    <Route path="/import" component={ImportLeads} />
    <Route path="/team" component={Team} />
    <Route path="/reports" component={Reports} />
    <Route path="/pdvs" component={Pdvs} />
    <Route path="/campaigns" component={Campaigns} />
    <Route path="/audit" component={Audit} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary>
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </ThemeProvider>
  </ErrorBoundary>;
}

export default App;
