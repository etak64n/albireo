import { LoaderCircle } from "lucide-react";

/** A turning circle in the middle of its box, while something loads. */
export function Spinner() {
  return (
    <div role="status" className="grid h-full min-h-40 place-items-center text-muted">
      <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
