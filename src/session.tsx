// Who uses the app. The app loads the signed-in person once when it starts, shares them with
// every page, and speaks the language that they chose. Without a session, it shows the page
// that signs in, or the page that creates the first admin while albireo has nobody. A link of an
// invitation opens the page that makes an account with it.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LANGUAGES, type Language, type Me, type SignedOutCode } from "../shared/api.ts";
import { api, ApiError, isSignedOutCode, onSignedOut } from "./api.ts";
import { setLanguage } from "./i18n.ts";
import { JoinPage, SetupPage, SignInPage } from "./pages/SignInPages.tsx";
import { navigate, usePathname } from "./router.tsx";

interface Session {
  me: Me;
  /** Replaces the signed-in person after a change, such as a new display name or language. */
  setMe: (me: Me) => void;
  /** Ends the session of this browser, and shows the page that signs in. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

type State =
  | { name: "loading" }
  | { name: "signed-in"; me: Me }
  | { name: "signed-out"; code: SignedOutCode }
  | { name: "failed"; message: string };

/** Before anyone signs in, the pages speak the first language of the browser that albireo has, or English. */
function browserLanguage(): Language {
  for (const tag of navigator.languages) {
    const language = LANGUAGES.find((candidate) => tag.toLowerCase().split("-")[0] === candidate);
    if (language !== undefined) return language;
  }
  return "en";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ name: "loading" });
  const pathname = usePathname();

  const signedIn = useCallback((me: Me) => {
    setLanguage(me.language);
    setState({ name: "signed-in", me });
  }, []);

  const signedOut = useCallback((code: SignedOutCode) => {
    setLanguage(browserLanguage());
    setState({ name: "signed-out", code });
  }, []);

  useEffect(() => {
    api.getMe().then(
      ({ me }) => signedIn(me),
      (error: unknown) => {
        if (error instanceof ApiError && isSignedOutCode(error.code)) signedOut(error.code);
        else setState({ name: "failed", message: error instanceof Error ? error.message : String(error) });
      },
    );
  }, [signedIn, signedOut]);

  // A session can end while a page is open: it expires, the person changes their password in
  // another browser, or an admin removes them. The page that signs in then takes over.
  useEffect(() => onSignedOut(signedOut), [signedOut]);

  const signOut = useCallback(async () => {
    await api.signOut();
    signedOut("signed_out");
  }, [signedOut]);

  if (state.name === "loading") return null;
  if (state.name === "failed") {
    return (
      <main className="mx-auto max-w-[640px] p-4">
        <p className="error-box">{state.message}</p>
      </main>
    );
  }
  const joinToken = /^\/join\/([^/]+)$/.exec(pathname)?.[1];
  if (joinToken !== undefined) {
    return (
      <JoinPage
        token={joinToken}
        signedInAs={state.name === "signed-in" ? state.me : null}
        onJoined={(me) => {
          signedIn(me);
          navigate("/");
        }}
        onSignOut={signOut}
      />
    );
  }
  if (state.name === "signed-out") {
    // After a sign-in, the page of the address opens, so a link that needed a sign-in still works.
    return state.code === "setup_needed" ? <SetupPage onDone={signedIn} /> : <SignInPage onDone={signedIn} />;
  }
  return <SessionContext.Provider value={{ me: state.me, setMe: signedIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession needs a SessionProvider around the page.");
  return session;
}
