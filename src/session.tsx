// The signed-in person, loaded once when the app starts and shared by every page. The app
// speaks the language that the person chose.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me } from "../shared/api.ts";
import { api } from "./api.ts";
import { setLanguage } from "./i18n.ts";

interface Session {
  me: Me;
  /** Replaces the signed-in person after a change, such as a new display name or language. */
  setMe: (me: Me) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getMe()
      .then(({ me: loaded }) => {
        setLanguage(loaded.language);
        setMe(loaded);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const update = useCallback((next: Me) => {
    setLanguage(next.language);
    setMe(next);
  }, []);

  if (error !== "") {
    return (
      <main className="mx-auto max-w-[640px] p-4">
        <p className="error-box">{error}</p>
      </main>
    );
  }
  // The pages need to know who is signed in, so they wait for it. The request is quick.
  if (me === null) return null;
  return <SessionContext.Provider value={{ me, setMe: update }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession needs a SessionProvider around the page.");
  return session;
}

/**
 * Logs out of Access. albireo first forgets the session of this device, so that the account
 * page stops listing it, but logging out goes ahead even when that fails.
 */
export async function logOut(logoutUrl: string): Promise<void> {
  await api.endSession().catch(() => undefined);
  window.location.assign(logoutUrl);
}
