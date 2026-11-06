import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";

/** A page that does not exist: the message, and the way home. */
export function NotFoundPage() {
  usePageTitle("Not found");
  return (
    <Shell>
      <section className="grid justify-items-center gap-4 py-20 text-center">
        <h1 className="text-display font-bold text-heading">This page does not exist.</h1>
        <Button asChild variant="primary">
          <Link to="/">Back to the library</Link>
        </Button>
      </section>
    </Shell>
  );
}
