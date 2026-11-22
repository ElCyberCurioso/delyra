import "./styles.css";
import { ThemeProvider } from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppRouter } from "./router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});
const router = createAppRouter();

const container = document.getElementById("root");
if (!container) throw new Error("Falta el elemento #root");

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
