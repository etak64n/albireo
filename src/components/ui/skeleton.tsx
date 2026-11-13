import { cn } from "../../lib/utils.ts";

/** A gray block that holds the place of content while it loads, so the page does not jump. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-xs bg-surface-subdued", className)} />;
}
