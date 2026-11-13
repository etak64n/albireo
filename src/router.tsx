// A small router for the pages of albireo, built on the History API.

import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ID_PATTERN } from "../shared/api.ts";

export type Route =
  | { name: "home" }
  | { name: "all-videos" }
  | { name: "all-series" }
  | { name: "all-playlists" }
  | { name: "history" }
  | { name: "search" }
  | { name: "upload" }
  | { name: "channel-settings" }
  | { name: "account" }
  | { name: "people" }
  | { name: "video"; id: string }
  | { name: "video-edit"; id: string }
  | { name: "series"; id: string }
  | { name: "playlist"; id: string }
  | { name: "user"; id: string }
  | { name: "not-found" };

const PAGES = { videos: "video", series: "series", playlists: "playlist", users: "user" } as const;

/**
 * Where the app lives: "" on its own domain, and "/albireo" for the demo on GitHub Pages,
 * which serves a project under its name. Paths in the app leave it out.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function matchRoute(pathname: string): Route {
  if (pathname === "/") return { name: "home" };
  if (pathname === "/videos") return { name: "all-videos" };
  if (pathname === "/series") return { name: "all-series" };
  if (pathname === "/playlists") return { name: "all-playlists" };
  if (pathname === "/history") return { name: "history" };
  if (pathname === "/search") return { name: "search" };
  if (pathname === "/upload") return { name: "upload" };
  if (pathname === "/settings/channel") return { name: "channel-settings" };
  if (pathname === "/settings/account") return { name: "account" };
  if (pathname === "/settings/people") return { name: "people" };
  const edit = /^\/videos\/([^/]+)\/edit$/.exec(pathname)?.[1];
  if (edit !== undefined && ID_PATTERN.test(edit)) return { name: "video-edit", id: edit };
  const match = /^\/(videos|series|playlists|users)\/([^/]+)$/.exec(pathname);
  const page = match?.[1] as keyof typeof PAGES | undefined;
  const id = match?.[2];
  if (page !== undefined && id !== undefined && ID_PATTERN.test(id)) return { name: PAGES[page], id };
  return { name: "not-found" };
}

/** Opens a page. The state travels with the history entry, such as a request to start playing. */
export function navigate(to: string, state: unknown = null): void {
  window.history.pushState(state, "", BASE + to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** The path of the page that is open, such as /series/abc, without the base of the app. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname.slice(BASE.length) || "/");
}

/** The query string of the page that is open, such as ?q=sync. */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

export function useRoute(): Route {
  return matchRoute(usePathname());
}

export function Link({
  to,
  className,
  current = false,
  role,
  children,
}: {
  to: string;
  className?: string;
  /** Marks the link to the page that is open, for screen readers. */
  current?: boolean;
  /** The role of the link, such as menuitem in a menu. */
  role?: string;
  children: ReactNode;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser open new tabs and windows as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={BASE + to} onClick={handleClick} className={className} role={role} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}
