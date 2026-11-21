/**
 * URL ⇄ screen mapping for the workspace, so refresh, bookmarks and back/forward keep the current page.
 *
 *   /                                  home
 *   /projects | /researchers | /format | /github | /platforms | /profile
 *   /projects/{id}                     project dashboard
 *   /projects/{id}/{view}              members, notes, data, imaging, ai, github, cover
 *   /projects/{id}/notes/{noteId}      an open research note
 *   /projects/{id}/notes/review        note review queue (a sub-page of 연구노트)
 */

export const USER_SECTIONS = ["home", "projects", "researchers", "format", "github", "platforms", "profile"] as const;
export const PROJECT_VIEWS = ["dashboard", "members", "notes", "review", "data", "imaging", "ai", "github", "cover"] as const;

export type RouteSection = (typeof USER_SECTIONS)[number];
export type RouteProjectView = (typeof PROJECT_VIEWS)[number];

export type AppRoute =
  | { kind: "section"; section: RouteSection }
  | { kind: "project"; projectId: string; view: RouteProjectView; noteId?: string };

const isSection = (value: string): value is RouteSection => (USER_SECTIONS as readonly string[]).includes(value);
const isView = (value: string): value is RouteProjectView => (PROJECT_VIEWS as readonly string[]).includes(value);

export function parseRoute(pathname: string, search: string): AppRoute {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "projects" && parts[1]) {
    if (parts[2] === "notes" && parts[3] === "review") return { kind: "project", projectId: parts[1], view: "review" };
    const view = parts[2] && isView(parts[2]) ? parts[2] : "dashboard";
    const noteId = view === "notes" && parts[3] ? parts[3] : undefined;
    return { kind: "project", projectId: parts[1], view, noteId };
  }
  void search;
  const section = parts[0] && isSection(parts[0]) ? parts[0] : "home";
  return { kind: "section", section };
}

export function buildPath(route: AppRoute): string {
  if (route.kind === "project") {
    const base = `/projects/${encodeURIComponent(route.projectId)}`;
    if (route.view === "review") return `${base}/notes/review`;
    if (route.view === "notes" && route.noteId) return `${base}/notes/${encodeURIComponent(route.noteId)}`;
    return route.view === "dashboard" ? base : `${base}/${route.view}`;
  }
  if (route.section === "home") return "/";
  return `/${route.section}`;
}

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/** Writes the URL without reloading. `replace` keeps history clean while a route is being restored. */
export function writePath(path: string, replace: boolean) {
  if (path === currentPath()) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}

// ─── Admin console ───────────────────────────────────────────────────────

export function parseAdminSection<T extends string>(pathname: string, sections: readonly T[], fallback: T): T {
  const part = pathname.split("/").filter(Boolean)[1];
  return part && (sections as readonly string[]).includes(part) ? (part as T) : fallback;
}

export function adminPath(section: string, fallback: string): string {
  return section === fallback ? "/admin" : `/admin/${section}`;
}
