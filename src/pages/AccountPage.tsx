import { useState } from "react";
import { LANGUAGES, type Language } from "../../shared/api.ts";
import { api } from "../api.ts";
import { DetailTable, PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Select } from "../components/ui/select.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { currentMessages, LANGUAGE_NAMES, useT } from "../i18n.ts";
import { formatDate } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { useSession } from "../session.tsx";

/** What the person sees about their account: when albireo added them, and the language of the app. */
export function AccountPage() {
  const { me } = useSession();
  const t = useT();
  usePageTitle(t.common.account);

  return (
    <Shell>
      <PageHeader title={t.common.account} />
      <div className="grid w-full max-w-[760px] gap-12">
        <Section title={t.account.details}>
          <DetailTable items={[{ label: t.account.joined, value: formatDate(me.joinedAt) }]} />
        </Section>
        <PreferencesSection />
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
