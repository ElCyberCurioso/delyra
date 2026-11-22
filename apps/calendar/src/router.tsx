import { AuthLayout, Button } from "@delyra/ui";
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
  type RouterHistory,
} from "@tanstack/react-router";
import { LoginPage } from "./auth/login-page";
import { ForgotPasswordPage, ResetPasswordPage } from "./auth/password-pages";
import { RegisterPage } from "./auth/register-page";
import { TotpSetupPage } from "./auth/totp-setup-page";
import { VerifyPage } from "./auth/verify-page";

/** `?next=` solo se acepta como texto; `resolveNext` decide luego si es un destino seguro. */
function nextSearch(search: Record<string, unknown>): { next?: string } {
  return typeof search.next === "string" ? { next: search.next } : {};
}

function NotFound() {
  return (
    <AuthLayout title="Página no encontrada" description="La dirección no existe o ha cambiado.">
      <Button asChild className="w-full">
        <Link to="/">Ir al inicio</Link>
      </Button>
    </AuthLayout>
  );
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    // FullCalendar y chrono-node solo se descargan al entrar en el calendario.
    component: lazyRouteComponent(() => import("./calendar/calendar-page"), "CalendarPage"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    validateSearch: nextSearch,
    component: LoginPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/login/verificar",
    validateSearch: nextSearch,
    component: VerifyPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/configurar-2fa",
    validateSearch: nextSearch,
    component: TotpSetupPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/registro", component: RegisterPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/ajustes",
    component: lazyRouteComponent(() => import("./settings/settings-page"), "SettingsPage"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/importar",
    component: lazyRouteComponent(() => import("./imports/import-page"), "ImportPage"),
  }),
  // Públicas (pantalla de consentimiento de Google, F5-04).
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacidad",
    component: lazyRouteComponent(() => import("./legal/legal-pages"), "PrivacyPage"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/terminos",
    component: lazyRouteComponent(() => import("./legal/legal-pages"), "TermsPage"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: lazyRouteComponent(() => import("./admin/admin-page"), "AdminPage"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/recuperar",
    component: ForgotPasswordPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/restablecer",
    component: ResetPasswordPage,
  }),
]);

export function createAppRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, history, defaultPreload: false, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
