import "./styles.css";
import {
  ApiError,
  getLocale,
  LocaleProvider,
  setupServiceWorker,
  subscribeLocale,
  ThemeProvider,
  ui,
} from "@delyra/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { createAppRouter } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Un 4xx (sin acceso, borrado…) no cambia por repetir: se muestra al momento.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 3,
    },
  },
});
const router = createAppRouter();

// F7-06: idioma y título de la página (el HTML estático llega en español).
const syncDocument = () => {
  document.documentElement.lang = getLocale();
  document.title = `${ui().shell.work} · Delyra`;
};
syncDocument();
subscribeLocale(syncDocument);

const container = document.getElementById("root");
if (!container) throw new Error("Falta el elemento #root");

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <RouterProvider router={router} />
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

// F7-01: PWA (caché de lectura sin conexión y aviso de versión nueva).
setupServiceWorker(registerSW);
