import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../i18n.ts";

// The next page starts to load while the end of the list is still this far below the screen.
const AHEAD = "0px 0px 600px 0px";

/**
 * The end of a list that has more pages: it loads the next page by itself when the end comes
 * near the bottom of the screen, so the list grows as you scroll, and turns while a page loads.
 * A page loads only when the end comes into view, as a button would load it only when pressed.
 */
export function LoadMore({ loading, onLoad }: { loading: boolean; onLoad: () => Promise<void> }) {
  const end = useRef<HTMLDivElement>(null);
  // Set at once when a page is asked for, before the list shows it as loading, so that one page loads once.
  const asked = useRef(false);
  const t = useT();

  // After each page, a new observer reports at once whether the end is still in view, as on a
  // tall screen with a short page, and the next page loads then.
  useEffect(() => {
    const element = end.current;
    if (element === null || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (asked.current || !entries.some((entry) => entry.isIntersecting)) return;
        asked.current = true;
        observer.disconnect();
        void onLoad().finally(() => {
          asked.current = false;
        });
      },
      { rootMargin: AHEAD },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, onLoad]);

  return (
    <div ref={end} className="grid h-10 place-items-center text-subdued">
      {loading && (
        <span role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          <span className="sr-only">{t.common.loadingMore}</span>
        </span>
      )}
    </div>
  );
}
