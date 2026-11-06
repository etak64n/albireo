// The blocks that pages are made of: the heading of a page, the sections under it, the
// link back to the list above the heading of a detail page, and the list of details.

import type { ReactNode } from "react";
import { Link } from "../router.tsx";

/** The heading of a list page, with the actions of the whole page on its right, over a line. */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <h1 className="min-w-0 text-display font-bold break-words text-heading">{title}</h1>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A part of a page under a 20px heading, with its actions on the right of the heading. */
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-4">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
        <h2 className="text-figure font-bold text-strong">{title}</h2>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** The link back to the list that a detail page belongs to, over its heading. */
export function Breadcrumb({ to, children }: { to: string; children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb">
      <Link to={to} className="text-sm font-semibold text-accent hover:underline">
        {children}
      </Link>
    </nav>
  );
}

/**
 * Facts of one thing, each as its name and the value under it: one under another in a
 * narrow column, or side by side in rows across a page.
 */
export function DetailList({ items, layout = "column" }: { items: { label: string; value: ReactNode }[]; layout?: "column" | "row" }) {
  return (
    <dl className={layout === "column" ? "grid gap-4" : "grid grid-cols-2 gap-x-8 gap-y-4 @xl:grid-cols-3 @3xl:grid-cols-5"}>
      {items.map((item) => (
        <div key={item.label} className="grid gap-1">
          <dt className="text-sm font-bold text-strong">{item.label}</dt>
          <dd className="text-sm text-label">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
