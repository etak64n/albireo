import { useCallback, useEffect, useId, useState } from "react";
import { LANGUAGES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type Language, type Session } from "../../shared/api.ts";
import { api } from "../api.ts";
import { DetailTable, PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input, Label } from "../components/ui/field.tsx";
import { Select } from "../components/ui/select.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { currentMessages, LANGUAGE_NAMES, useT, type Messages } from "../i18n.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { useSession } from "../session.tsx";

// The head and the cells of the table of sessions, as in the table of a series.
const HEAD = "h-9 px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-label";
const CELL = "px-2 py-3 align-middle";

/** What only the signed-in person sees about themselves: their details, their language, their password, and their sessions. */
export function AccountPage() {
  const { me } = useSession();
  const t = useT();
  usePageTitle(t.common.account);
  // The list of sessions loads again after a change of the password, which ends the others.
  const [sessionsVersion, setSessionsVersion] = useState(0);

  return (
    <Shell>
      <PageHeader title={t.common.account} />
      <div className="grid w-full max-w-[760px] gap-12">
        <Section title={t.account.details}>
          <DetailTable
            items={[
              { label: t.account.email, value: me.email },
              // Admins edit every video, series, and playlist, and invite people; members edit their own.
              { label: t.account.role, value: me.isAdmin ? t.account.admin : t.account.member },
              { label: t.account.joined, value: formatDate(me.joinedAt) },
            ]}
          />
        </Section>
        <PreferencesSection />
        <PasswordSection onChanged={() => setSessionsVersion((version) => version + 1)} />
        <SessionsSection key={sessionsVersion} />
      </div>
    </Shell>
  );
}

/** The language of the app. A choice saves at once, and the whole app switches to it. */
function PreferencesSection() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function choose(language: Language) {
    setSaving(true);
    try {
      setMe((await api.updateMe({ language })).me);
      // The message comes in the language just chosen.
      toast.success(currentMessages().toast.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
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
              <Select
                value={me.language}
                options={LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_NAMES[language], lang: language }))}
                onChange={(language) => void choose(language)}
                disabled={saving}
                aria-label={t.account.language}
                className="-my-1 w-fit"
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

/** A new password, with the current one. The change ends the sessions of every other browser. */
function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const { me } = useSession();
  const t = useT();
  const toast = useToast();
  const currentId = useId();
  const newId = useId();
  const hintId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function change() {
    setSaving(true);
    setError("");
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      toast.success(t.account.passwordChanged);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={t.account.password}>
      <form
        className="grid max-w-[400px] gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        {/* The email lets a password manager save the new password for the right account. */}
        <input type="email" autoComplete="username" value={me.email} readOnly hidden />
        <div className="grid gap-1.5">
          <Label htmlFor={currentId}>{t.account.currentPassword}</Label>
          <Input
            id={currentId}
            type="password"
            autoComplete="current-password"
            required
            maxLength={PASSWORD_MAX_LENGTH}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={newId}>{t.account.newPassword}</Label>
          <Input
            id={newId}
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            aria-describedby={hintId}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <p id={hintId} className="text-xs text-subdued">
            {t.auth.passwordLength(PASSWORD_MIN_LENGTH)}
          </p>
        </div>
        {error !== "" && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={saving}>
            {t.account.changePassword}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** The browsers that are signed in as the person, from the last used. Log out ends one of them. */
function SessionsSection() {
  const t = useT();
  const toast = useToast();
  const { signOut } = useSession();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.getSessions().then(
      (loaded) => setSessions(loaded.sessions),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  useEffect(load, [load]);

  async function end(session: Session) {
    try {
      if (session.current) {
        await signOut();
        return;
      }
      await api.endSession(session.id);
      setSessions((current) => current?.filter((other) => other.id !== session.id) ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Section title={t.account.sessions}>
      {error !== "" ? (
        <p className="error-box">{error}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={HEAD}>{t.account.device}</th>
              <th className={`${HEAD} max-md:hidden`}>{t.account.signedIn}</th>
              <th className={HEAD}>{t.account.lastActive}</th>
              <th className={HEAD}>
                <span className="sr-only">{t.account.logOut}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions === null ? (
              <tr className="border-b border-hairline">
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={`${CELL} max-md:hidden`}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={CELL} />
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session.id} className="border-b border-hairline">
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
                  <td className={`${CELL} text-strong max-md:hidden`}>{formatDateTime(session.signedInAt)}</td>
                  <td className={`${CELL} text-strong`}>{formatDateTime(session.lastActiveAt)}</td>
                  <td className={`${CELL} text-right`}>
                    <Button size="sm" onClick={() => void end(session)}>
                      {t.account.logOut}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/** "Chrome on macOS", or as much of it as albireo knows. */
function deviceName(session: Session, t: Messages): string {
  if (session.browser !== "" && session.os !== "") return t.account.deviceName(session.browser, session.os);
  return session.browser || session.os || t.account.unknownDevice;
}
