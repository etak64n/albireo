import { useEffect } from "react";
import appearance from "virtual:albireo-appearance";

/** Names the browser tab and the history entry: the page, then the site. With null, the site alone. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    document.title = title === null || title === "" ? appearance.siteName : `${title} - ${appearance.siteName}`;
  }, [title]);
}
