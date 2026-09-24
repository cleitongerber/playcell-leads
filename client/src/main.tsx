import { v2trpc } from "@/lib/v2trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

const queryClient = new QueryClient();

const v2TrpcClient = v2trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/v2/trpc",
      transformer: superjson,
      headers() {
        try {
          const partnerId = localStorage.getItem("v2-active-partner");
          return partnerId ? { "x-partner-id": partnerId } : {};
        } catch {
          return {};
        }
      },
      fetch(input, init) {
        return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <v2trpc.Provider client={v2TrpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </v2trpc.Provider>
);
