import { useEffect, useState } from "react";
import { isLanguage, LANGUAGES, type Language, type Passkey, type Session, type SignIn } from "../../shared/api.ts";
import { api } from "../api.ts";
import { DetailTable, PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { LANGUAGE_NAMES, useLanguage, useT, type Messages } from "../i18n.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { logOut, useSession } from "../session.tsx";

/** The names of the login methods of Cloudflare Access that are products, by the type that Access reports. */
const PRODUCT_LOGIN_METHODS: Record<string, string> = {
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

/** The name of a login method: passkeys and one-time PINs in the language of the app, and the rest by their product. */
function loginMethodName(method: string, t: Messages): string {
  if (method === "passkeys") return t.account.passkey;
  if (method === "onetimepin") return t.account.oneTimePin;
  return PRODUCT_LOGIN_METHODS[method] ?? method;
}

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
 * Stripe: their details, their language, how and when they signed in, their passkeys,
 * and their sessions.
 */
export function AccountPage() {
  const { me } = useSession();
  const t = useT();
  const signIn = useLoaded(loadSignIn);
  const sessions = useLoaded(loadSessions);
  usePageTitle(t.common.account);

  return (
    <Shell>
      <PageHeader title={t.common.account} />
      <div className="grid w-full max-w-[760px] gap-12">
        <Section title={t.account.details}>
          <DetailTable
            items={[
              { label: t.account.email, value: me.email },
              // Admins edit every video and every series, and everyone else edits their own.
              { label: t.account.role, value: me.isAdmin ? t.account.admin : t.account.member },
              { label: t.account.joined, value: formatDate(me.joinedAt) },
            ]}
          />
        </Section>
        <PreferencesSection />
        <SignInSection signIn={signIn} />
        {signIn.state === "loaded" && signIn.value !== null && signIn.value.passkeys !== null && signIn.value.passkeys.length > 0 && (
          <PasskeysSection passkeys={signIn.value.passkeys} />
        )}
        <SessionsSection sessions={sessions} logoutUrl={me.logoutUrl} />
      </div>
    </Shell>
  );
}

/** The language of the app. A choice saves at once, and the whole app switches to it. */
function PreferencesSection() {
  const { me, setMe } = useSession();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function choose(language: Language) {
    setSaving(true);
    setError("");
    try {
      setMe((await api.updateMe({ language })).me);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={t.account.preferences}>
      <DetailTable
        items={[
          {
            label: t.account.language,
            value: (
              // The negative margins keep the row as high as the rows of text.
              <select
                value={me.language}
                onChange={(event) => {
                  if (isLanguage(event.target.value)) void choose(event.target.value);
                }}
                disabled={saving}
                aria-label={t.account.language}
                className="field -my-1 block w-auto"
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language} lang={language}>
                    {LANGUAGE_NAMES[language]}
                  </option>
                ))}
              </select>
            ),
          },
        ]}
      />
      {error && <p className="error-box">{error}</p>}
    </Section>
  );
}

/** How and when the person signed in. Under cf dev, where Access does not run, the section is left out. */
function SignInSection({ signIn }: { signIn: Loaded<SignIn | null> }) {
  const t = useT();
  if (signIn.state === "failed") {
    return (
      <Section title={t.account.signIn}>
        <ErrorBox error={signIn.error} />
      </Section>
    );
  }
  if (signIn.state === "loaded" && signIn.value === null) return null;
  const value = signIn.state === "loaded" ? signIn.value : null;
  return (
    <Section title={t.account.signIn}>
      <DetailTable
        items={[
          { label: t.account.loginMethod, value: value === null ? <Skeleton className="h-5 w-24" /> : loginMethodName(value.method, t) },
          { label: t.account.signedIn, value: value === null ? <Skeleton className="h-5 w-36" /> : formatDateTime(value.signedInAt) },
        ]}
      />
    </Section>
  );
}

/** The passkeys that the person registered with Access. */
function PasskeysSection({ passkeys }: { passkeys: Passkey[] }) {
  const t = useT();
  return (
    <Section title={t.account.passkeys}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={HEAD}>{t.account.name}</th>
            <th className={HEAD}>{t.account.added}</th>
            <th className={HEAD}>{t.account.lastUsed}</th>
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
  const t = useT();
  const language = useLanguage();
  if (sessions.state === "loaded" && sessions.value === null) return null;
  return (
    <Section
      title={t.account.sessions}
      actions={logoutUrl !== null && <Button onClick={() => void logOut(logoutUrl)}>{t.account.logOutOfThisDevice}</Button>}
    >
      {sessions.state === "failed" ? (
        <ErrorBox error={sessions.error} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={HEAD}>{t.account.device}</th>
              <th className={`${HEAD} max-sm:hidden`}>{t.account.location}</th>
              <th className={`${HEAD} max-md:hidden`}>{t.account.signedIn}</th>
              <th className={HEAD}>{t.account.lastActive}</th>
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
                      <span className="font-semibold text-strong">{deviceName(session, t)}</span>
                      {session.current && (
                        <span className="rounded-xs border border-border bg-surface-subdued px-1.5 text-xs leading-[18px] text-label">
                          {t.account.thisDevice}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`${CELL} text-strong max-sm:hidden`}>{placeName(session, t, language)}</td>
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
function deviceName(session: Session, t: Messages): string {
  if (session.browser !== "" && session.os !== "") return t.account.deviceName(session.browser, session.os);
  return session.browser || session.os || t.account.unknownDevice;
}

/** "Tokyo, Japan", or as much of it as Cloudflare told, with the country in the language of the app. */
function placeName(session: Session, t: Messages, language: Language): string {
  const country = session.country === "" ? "" : (new Intl.DisplayNames([language], { type: "region" }).of(session.country) ?? session.country);
  return t.account.place(session.city, country) || "—";
}
