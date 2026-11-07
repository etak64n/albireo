import { useEffect, useState } from "react";
import type { SignIn } from "../../shared/api.ts";
import { api } from "../api.ts";
import { DetailList, PageHeader } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { formatDateTime } from "../lib/format.ts";
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

/** What only the signed-in person sees about themselves: the email that they signed in with, and how and when they signed in. */
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

  return (
    <Shell>
      <PageHeader title="Account" />
      <div className="grid w-full max-w-[560px] gap-6">
        <DetailList
          items={[
            { label: "Email", value: me.email },
            ...(signIn === undefined && error === null
              ? [
                  { label: "Login method", value: <Skeleton className="h-5 w-24" /> },
                  { label: "Signed in", value: <Skeleton className="h-5 w-36" /> },
                ]
              : signIn
                ? [
                    { label: "Login method", value: LOGIN_METHOD_NAMES[signIn.method] ?? signIn.method },
                    { label: "Signed in", value: formatDateTime(signIn.signedInAt) },
                  ]
                : []),
          ]}
        />
        {error !== null && <p className="error-box">{error instanceof Error ? error.message : String(error)}</p>}
      </div>
    </Shell>
  );
}
