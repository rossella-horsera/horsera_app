import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import JourneyPage from "./pages/JourneyPage";
import RidesPage from "./pages/RidesPage";
import RideDetailPage from "./pages/RideDetailPage";
import InsightsPage from "./pages/InsightsPage";
import NotFound from "./pages/NotFound";
import AnalysisShell from "./pages/analysis/AnalysisShell";
import RideTab from "./pages/analysis/RideTab";
import ReportTab from "./pages/analysis/ReportTab";
import InsightsTab from "./pages/analysis/InsightsTab";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<RidesPage />} />
            <Route path="/rides" element={<Navigate to="/" replace />} />
            <Route path="/rides/:id" element={<RideDetailPage />} />
            <Route path="/journey" element={<JourneyPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/analysis" element={<AnalysisShell />}>
              <Route index element={<RideTab />} />
              <Route path="report" element={<ReportTab />} />
              <Route path="insights" element={<InsightsTab />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
