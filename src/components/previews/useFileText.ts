import { useEffect, useState } from "react";
import { currentMessages } from "../../i18n.ts";

/** Reads a text file from its signed URL. The bucket must allow GET from this site in its CORS rules. */
export function useFileText(url: string): { text: string | null; error: string } {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(currentMessages().files.storageAnswered(response.status));
        setText(await response.text());
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // fetch rejects with a TypeError when CORS or the network stops the request.
        setError(
          err instanceof TypeError
            ? currentMessages().files.unreadable
            : err instanceof Error
              ? err.message
              : String(err),
        );
      });
    return () => controller.abort();
  }, [url]);

  return { text, error };
}
