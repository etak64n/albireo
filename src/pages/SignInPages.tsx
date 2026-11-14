// The pages of a browser without a session: signing in, creating the first admin with the setup
// code, and joining with an invitation. They stand alone, without the sidebar and the bar of the
// library, which show the signed-in person.

import { useEffect, useId, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import appearance from "virtual:albireo-appearance";
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  type JoinInfo,
  type Me,
} from "../../shared/api.ts";
import { api } from "../api.ts";
import { Logo } from "../components/Logo.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input, Label } from "../components/ui/field.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { useT } from "../i18n.ts";
import { formatDate } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { navigate } from "../router.tsx";

/** A page without the frame of the library: the logo and the name of the library over a form. */
function Frame({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  usePageTitle(title);
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-[400px] gap-6">
        <div className="flex items-center gap-3">
          <Logo alt="" className="size-8" />
          <span className="truncate text-base font-semibold text-heading">{appearance.siteName}</span>
        </div>
        <div className="grid gap-2">
          <h1 className="text-display font-bold break-words text-heading">{title}</h1>
          {intro !== undefined && <p className="text-sm text-label">{intro}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

/** A field with its label, and under it what it must hold. */
function TextField({
  label,
  hint,
  value,
  onChange,
  ...input
}: { label: string; hint?: string; value: string; onChange: (value: string) => void } & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint === undefined ? undefined : hintId}
        required
        {...input}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-subdued">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Sends a form once at a time, and keeps the message of a failure for the page. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      // A success replaces the page, so the page keeps busy until it goes.
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

function FormError({ error }: { error: string }) {
  if (error === "") return null;
  return (
    <p className="error-box" role="alert">
      {error}
    </p>
  );
}

export function SignInPage({ onDone }: { onDone: (me: Me) => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(async () => onDone((await api.signIn({ email, password })).me));
  return (
    <Frame title={t.auth.signInTitle(appearance.siteName)}>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <TextField label={t.auth.email} type="email" autoComplete="username" maxLength={EMAIL_MAX_LENGTH} value={email} onChange={setEmail} />
        <TextField
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={setPassword}
        />
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {t.auth.signIn}
        </Button>
      </form>
    </Frame>
  );
}

/** The fields of a new account: the email, the display name, and the password. */
function AccountFields({
  email,
  displayName,
  password,
  onEmail,
  onDisplayName,
  onPassword,
}: {
  email: string;
  displayName: string;
  password: string;
  onEmail: (value: string) => void;
  onDisplayName: (value: string) => void;
  onPassword: (value: string) => void;
}) {
  const t = useT();
  return (
    <>
      <TextField label={t.auth.email} type="email" autoComplete="username" maxLength={EMAIL_MAX_LENGTH} value={email} onChange={onEmail} />
      <TextField
        label={t.auth.displayName}
        autoComplete="name"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        value={displayName}
        onChange={onDisplayName}
      />
      <TextField
        label={t.auth.password}
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={password}
        onChange={onPassword}
      />
    </>
  );
}

/** The first admin, with the setup code that albireo writes to its log while it has nobody. */
export function SetupPage({ onDone }: { onDone: (me: Me) => void }) {
  const t = useT();
  const [setupCode, setSetupCode] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(async () => onDone((await api.setup({ setupCode, email, displayName, password })).me));
  return (
    <Frame title={t.auth.setupTitle} intro={t.auth.setupIntro}>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <TextField
          label={t.auth.setupCode}
          hint={t.auth.setupCodeHint}
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          value={setupCode}
          onChange={setSetupCode}
        />
        <AccountFields
          email={email}
          displayName={displayName}
          password={password}
          onEmail={setEmail}
          onDisplayName={setDisplayName}
          onPassword={setPassword}
        />
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {t.auth.createAdmin}
        </Button>
      </form>
    </Frame>
  );
}

/**
 * The page of an invitation link, /join/<token>: who invited the person, and the fields of
 * their account. A browser that is signed in already offers to log out first.
 */
export function JoinPage({
  token,
  signedInAs,
  onJoined,
  onSignOut,
}: {
  token: string;
  signedInAs: Me | null;
  onJoined: (me: Me) => void;
  onSignOut: () => Promise<void>;
}) {
  const t = useT();
  const [invitation, setInvitation] = useState<JoinInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [signOutError, setSignOutError] = useState("");
  const { busy, error, submit } = useSubmit(async () => onJoined((await api.join(token, { email, displayName, password })).me));

  useEffect(() => {
    let active = true;
    api.getJoinInfo(token).then(
      (loaded) => {
        if (active) setInvitation(loaded.invitation);
      },
      (err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [token]);

  const title = t.auth.joinTitle(appearance.siteName);
  if (loadError !== "") {
    return (
      <Frame title={title}>
        <FormError error={loadError} />
      </Frame>
    );
  }
  if (invitation === null) {
    return (
      <Frame title={title}>
        <Spinner />
      </Frame>
    );
  }
  const intro = `${t.auth.joinIntro(invitation.invitedBy, invitation.isAdmin)} ${t.auth.joinExpires(formatDate(invitation.expiresAt))}`;
  if (signedInAs !== null) {
    return (
      <Frame title={title} intro={intro}>
        <p className="text-sm text-strong">{t.auth.signedInAlready(signedInAs.displayName)}</p>
        <FormError error={signOutError} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setSignOutError("");
              onSignOut().catch((err: unknown) => setSignOutError(err instanceof Error ? err.message : String(err)));
            }}
          >
            {t.account.logOut}
          </Button>
          <Button size="lg" onClick={() => navigate("/")}>
            {t.auth.openLibrary}
          </Button>
        </div>
      </Frame>
    );
  }
  return (
    <Frame title={title} intro={intro}>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <AccountFields
          email={email}
          displayName={displayName}
          password={password}
          onEmail={setEmail}
          onDisplayName={setDisplayName}
          onPassword={setPassword}
        />
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {t.auth.join}
        </Button>
      </form>
    </Frame>
  );
}
