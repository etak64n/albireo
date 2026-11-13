import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { useT } from "../i18n.ts";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";

/** A page that does not exist: the message, and the way home. */
export function NotFoundPage() {
  const t = useT();
  usePageTitle(t.notFound.title);
  return (
    <Shell>
      <section className="grid justify-items-center gap-4 py-20 text-center">
        <h1 className="text-display font-bold text-heading">{t.notFound.message}</h1>
        <Button asChild variant="primary">
          <Link to="/">{t.notFound.back}</Link>
        </Button>
      </section>
    </Shell>
  );
}
