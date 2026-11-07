import { useEffect, useState } from "react";
import type { Passkey, Session, SignIn } from "../../shared/api.ts";
import { api } from "../api.ts";
import { DetailTable, PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { logOut, useSession } from "../session.tsx";

/** The names of the login methods of Cloudflare Access, by the type that Access reports. */
const LOGIN_METHOD_NAMES: Record<string, string> = {
  passkeys: "Passkey",
  onetimepin: "One-time PIN",
  github: "GitHub",
  google: "Google",
  "google-apps": "Google Workspace",
  azureAD: "Microsoft Entra ID",
  okta: "Okta",
  onelogin: "OneLogin",
  pingone: "PingOne",
  centrify: "Centrify",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  yandex: "Yandex",
  oidc: "OpenID Connect",
  saml: "SAML",
};

// The head and the cells of the tables of passkeys and sessions, as in the table of a series.
const HEAD = "h-9 px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-label";
const CELL = "px-2 py-3 align-middle";

/** What albireo has loaded from the API: nothing yet, the value, or the error. */
type Loaded<T> = { state: "loading" } | { state: "loaded"; value: T } | { state: "failed"; error: unknown };

/** Loads a part of the page once, when the page opens. `load` must not change between renders. */
function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    let current = true;
    load().then(
      (value) => {
        if (current) setLoaded({ state: "loaded", value });
      },
      (error: unknown) => {
        if (current) setLoaded({ state: "failed", error });
      },
    );
    return () => {
      current = false;
    };
  }, [load]);
  return loaded;
}

const loadSignIn = async () => (await api.getSignIn()).signIn;
const loadSessions = async () => (await api.getSessions()).sessions;

/**
 * What only the signed-in person sees about themselves, laid out like the settings of
 * Stripe: their details, how and when they signed in, their passkeys, and their sessions.
 */
export function AccountPage() {
  const { me } = useSession();
  const signIn = useLoaded(loadSignIn);
  const sessions = useLoaded(loadSessions);
  usePageTitle("Account");

  return (
    <Shell>
      <PageHeader title="Account" />
      <div className="grid w-full max-w-[760px] gap-12">
        <Section title="Details">
          <DetailTable
            items={[
              { label: "Email", value: me.email },
              // Admins edit every video and every series, and everyone else edits their own.
              { label: "Role", value: me.isAdmin ? "Admin" : "Member" },
              { label: "Joined", value: formatDate(me.joinedAt) },
            ]}
          />
        </Section>
        <SignInSection signIn={signIn} />
        {signIn.state === "loaded" && signIn.value !== null && signIn.value.passkeys !== null && signIn.value.passkeys.length > 0 && (
          <PasskeysSection passkeys={signIn.value.passkeys} />
        )}
        <SessionsSection sessions={sessions} logoutUrl={me.logoutUrl} />
      </div>
    </Shell>
  );
}

/** How and when the person signed in. Under cf dev, where Access does not run, the section is left out. */
function SignInSection({ signIn }: { signIn: Loaded<SignIn | null> }) {
  if (signIn.state === "failed") {
    return (
      <Section title="Sign-in">
        <ErrorBox error={signIn.error} />
      </Section>
    );
  }
  if (signIn.state === "loaded" && signIn.value === null) return null;
  const value = signIn.state === "loaded" ? signIn.value : null;
  return (
    <Section title="Sign-in">
      <DetailTable
        items={[
          { label: "Login method", value: value === null ? <Skeleton className="h-5 w-24" /> : (LOGIN_METHOD_NAMES[value.method] ?? value.method) },
          { label: "Signed in", value: value === null ? <Skeleton className="h-5 w-36" /> : formatDateTime(value.signedInAt) },
        ]}
      />
    </Section>
  );
}

/** The passkeys that the person registered with Access. */
function PasskeysSection({ passkeys }: { passkeys: Passkey[] }) {
  return (
    <Section title="Passkeys">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={HEAD}>Name</th>
            <th className={HEAD}>Added</th>
            <th className={HEAD}>Last used</th>
          </tr>
        </thead>
        <tbody>
          {passkeys.map((passkey) => (
            <tr key={`${passkey.name} ${passkey.addedAt}`} className="border-b border-hairline">
              <td className={`${CELL} font-semibold text-strong`}>{passkey.name}</td>
              <td className={`${CELL} text-strong`}>{formatDate(passkey.addedAt)}</td>
              <td className={`${CELL} text-strong`}>{passkey.lastUsedAt === null ? "—" : formatDateTime(passkey.lastUsedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/**
 * The sessions that albireo saw, with the one of this device marked. albireo can end only
 * the session of this device: Access keeps the others.
 */
function SessionsSection({ sessions, logoutUrl }: { sessions: Loaded<Session[] | null>; logoutUrl: string | null }) {
  if (sessions.state === "loaded" && sessions.value === null) return null;
  return (
    <Section
      title="Sessions"
      actions={logoutUrl !== null && <Button onClick={() => void logOut(logoutUrl)}>Log out of this device</Button>}
    >
      {sessions.state === "failed" ? (
        <ErrorBox error={sessions.error} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={HEAD}>Device</th>
              <th className={`${HEAD} max-sm:hidden`}>Location</th>
              <th className={`${HEAD} max-md:hidden`}>Signed in</th>
              <th className={HEAD}>Last active</th>
            </tr>
          </thead>
          <tbody>
            {sessions.state === "loading" ? (
              <tr className="border-b border-hairline">
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={`${CELL} max-sm:hidden`}>
                  <Skeleton className="h-5 w-24" />
                </td>
                <td className={`${CELL} max-md:hidden`}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
              </tr>
            ) : (
              (sessions.value ?? []).map((session) => (
                <tr key={`${session.signedInAt} ${session.browser} ${session.os}`} className="border-b border-hairline">
                  <td className={CELL}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-strong">{deviceName(session)}</span>
                      {session.current && (
                        <span className="rounded-xs border border-border bg-surface-subdued px-1.5 text-xs leading-[18px] text-label">
                          This device
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`${CELL} text-strong max-sm:hidden`}>{placeName(session)}</td>
                  <td className={`${CELL} text-strong max-md:hidden`}>{formatDateTime(session.signedInAt)}</td>
                  <td className={`${CELL} text-strong`}>{formatDateTime(session.lastActiveAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  return <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>;
}

/** "Chrome on macOS", or as much of it as albireo knows. */
function deviceName(session: Session): string {
  if (session.browser !== "" && session.os !== "") return `${session.browser} on ${session.os}`;
  return session.browser || session.os || "Unknown device";
}

/** "Tokyo, Japan", or as much of it as Cloudflare told. */
function placeName(session: Session): string {
  const country = session.country === "" ? "" : (new Intl.DisplayNames(["en"], { type: "region" }).of(session.country) ?? session.country);
  return [session.city, country].filter((part) => part !== "").join(", ") || "—";
}
