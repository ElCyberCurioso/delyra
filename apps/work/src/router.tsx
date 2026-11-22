import { CARD_PRIORITIES, type CardPriority } from "@delyra/shared";
import { Button, FullPageSpinner } from "@delyra/ui";
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type RouterHistory,
  useNavigate,
} from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useCallback } from "react";
import { BoardsPage } from "./kanban/boards-page";
import { WorkLayout } from "./layout";

/** Búsqueda del tablero: tarjeta abierta y filtros (F4-09, F4-10). Todo va en la URL. */
export interface BoardSearch {
  tarjeta?: string;
  q?: string;
  etiqueta?: string;
  prioridad?: CardPriority;
  vence?: "vencidas" | "semana";
}

const text = (value: unknown, max = 200) =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;

export function boardSearch(search: Record<string, unknown>): BoardSearch {
  const prioridad = CARD_PRIORITIES.find((p) => p === search.prioridad);
  const vence = search.vence === "vencidas" || search.vence === "semana" ? search.vence : undefined;
  const result: BoardSearch = {};
  const tarjeta = text(search.tarjeta, 64);
  const q = text(search.q);
  const etiqueta = text(search.etiqueta, 64);
  if (tarjeta) result.tarjeta = tarjeta;
  if (q) result.q = q;
  if (etiqueta) result.etiqueta = etiqueta;
  if (prioridad) result.prioridad = prioridad;
  if (vence) result.vence = vence;
  return result;
}

/** Quita las claves vacías para que la URL quede limpia. */
export function cleanSearch(search: BoardSearch): BoardSearch {
  const result: BoardSearch = {};
  for (const [key, value] of Object.entries(search) as [keyof BoardSearch, string | undefined][]) {
    if (value !== undefined && value !== "") Object.assign(result, { [key]: value });
  }
  return result;
}

function NotFound(): ReactNode {
  return (
    <WorkLayout>
      {() => (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Página no encontrada</h1>
          <p className="text-muted-foreground">La dirección no existe o ha cambiado.</p>
          <Button asChild>
            <Link to="/">Ir a mis tableros</Link>
          </Button>
        </div>
      )}
    </WorkLayout>
  );
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });

// dnd-kit, markdown-it y DOMPurify solo se descargan al abrir un tablero.
const BoardPage = lazy(() =>
  import("./kanban/board-page").then((module) => ({ default: module.BoardPage })),
);

/**
 * La ruta lee parámetros y búsqueda y se los pasa a la página, que se carga aparte y así no
 * depende de los tipos del router.
 */
function BoardRoute(): ReactNode {
  // Los hooks de ruta devuelven `any` con estas versiones de tipos; `select` los fija aquí, en el
  // único punto de entrada (validateSearch ya garantiza la forma de la búsqueda).
  const boardId = boardRoute.useParams({ select: (params: { boardId: string }) => params.boardId });
  const search = boardRoute.useSearch({ select: (value: BoardSearch) => value });
  const navigate = useNavigate();
  const setSearch = useCallback(
    (patch: Partial<BoardSearch>) =>
      void navigate({
        to: "/tableros/$boardId",
        params: { boardId },
        search: (prev: BoardSearch) => cleanSearch({ ...prev, ...patch }),
        replace: true,
      }),
    [navigate, boardId],
  );
  return (
    <Suspense fallback={<FullPageSpinner label="Cargando tablero…" />}>
      <BoardPage boardId={boardId} search={search} setSearch={setSearch} />
    </Suspense>
  );
}

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tableros/$boardId",
  validateSearch: boardSearch,
  component: BoardRoute,
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: BoardsPage }),
  boardRoute,
]);

export function createAppRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, history, defaultPreload: false, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
