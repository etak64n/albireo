import { LoaderCircle } from "lucide-react";
import { useT } from "../../i18n.ts";

/** A turning circle in the middle of its box, while something loads. */
export function Spinner() {
  const t = useT();
  return (
    <div role="status" className="grid h-full min-h-40 place-items-center text-subdued">
      <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">{t.common.loading}</span>
    </div>
  );
}
