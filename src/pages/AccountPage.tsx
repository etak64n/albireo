import { useEffect, useState } from "react";
import type { Passkey, SignIn } from "../../shared/api.ts";
import { api } from "../api.ts";
import { DetailList, PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { useSession } from "../session.tsx";

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

/**
 * What only the signed-in person sees about themselves: their email, their role, and the
 * day they joined, then how and when they signed in, and their passkeys.
 */
export function AccountPage() {
  const { me } = useSession();
  // How the person signed in: undefined while it loads, and null under cf dev, where Access does not run.
  const [signIn, setSignIn] = useState<SignIn | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  usePageTitle("Account");

  useEffect(() => {
    let current = true;
    api.getSignIn().then(
      (response) => {
        if (current) setSignIn(response.signIn);
      },
      (err: unknown) => {
        if (current) setError(err);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // Access tells the rest under Sign-in. It has nothing to tell under cf dev, where it does not run.
  const signInItems =
    signIn === undefined && error === null
      ? [
          { label: "Login method", value: <Skeleton className="h-5 w-24" /> },
          { label: "Signed in", value: <Skeleton className="h-5 w-36" /> },
        ]
      : signIn
        ? [
            { label: "Login method", value: LOGIN_METHOD_NAMES[signIn.method] ?? signIn.method },
            { label: "Signed in", value: formatDateTime(signIn.signedInAt) },
            ...(signIn.passkeys !== null && signIn.passkeys.length > 0 ? [{ label: "Passkeys", value: <PasskeyList passkeys={signIn.passkeys} /> }] : []),
          ]
        : [];

  return (
    <Shell>
      <PageHeader title="Account" />
      <div className="grid w-full max-w-[560px] gap-8">
        <DetailList
          items={[
            { label: "Email", value: me.email },
            // Admins edit every video and every series, and everyone else edits their own.
            { label: "Role", value: me.isAdmin ? "Admin" : "Member" },
            { label: "Joined", value: formatDate(me.joinedAt) },
          ]}
        />
        {(signInItems.length > 0 || error !== null) && (
          <Section title="Sign-in">
            {signInItems.length > 0 && <DetailList items={signInItems} />}
            {error !== null && <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>}
          </Section>
        )}
      </div>
    </Shell>
  );
}

/** The passkeys of the person, each with the day it was added and the last time it was used. */
function PasskeyList({ passkeys }: { passkeys: Passkey[] }) {
  return (
    <ul className="grid gap-2">
      {passkeys.map((passkey) => (
        <li key={`${passkey.name} ${passkey.addedAt}`} className="grid gap-0.5">
          <span className="text-strong">{passkey.name}</span>
          <span className="text-subdued">
            Added {formatDate(passkey.addedAt)}
            {passkey.lastUsedAt !== null && ` · Last used ${formatDateTime(passkey.lastUsedAt)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
