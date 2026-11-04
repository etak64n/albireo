// A small router for the pages of albireo, built on the History API.

import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ID_PATTERN } from "../shared/api.ts";

export type Route =
  | { name: "home" }
  | { name: "all-videos" }
  | { name: "history" }
  | { name: "search" }
  | { name: "settings" }
  | { name: "video"; id: string }
  | { name: "series"; id: string }
  | { name: "user"; id: string }
  | { name: "not-found" };

const PAGES = { videos: "video", series: "series", users: "user" } as const;

export function matchRoute(pathname: string): Route {
  if (pathname === "/") return { name: "home" };
  if (pathname === "/videos") return { name: "all-videos" };
  if (pathname === "/history") return { name: "history" };
  if (pathname === "/search") return { name: "search" };
  if (pathname === "/settings") return { name: "settings" };
  const match = /^\/(videos|series|users)\/([^/]+)$/.exec(pathname);
  const page = match?.[1] as keyof typeof PAGES | undefined;
  const id = match?.[2];
  if (page !== undefined && id !== undefined && ID_PATTERN.test(id)) return { name: PAGES[page], id };
  return { name: "not-found" };
}

/** Opens a page. The state travels with the history entry, such as a request to start playing. */
export function navigate(to: string, state: unknown = null): void {
  window.history.pushState(state, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** The path of the page that is open, such as /series/abc. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
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
    <a href={to} onClick={handleClick} className={className} role={role} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}
