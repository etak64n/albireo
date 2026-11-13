import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "../lib/utils.ts";

/** "control" matches the height of a button, and "large" the picture beside the heading of a page. */
const SIZES = { tiny: "size-5", control: "size-7", small: "size-8", large: "size-14", huge: "size-24" } as const;

/**
 * The picture of a person in a circle. Without a picture of their own, or while it
 * loads, a person shape stands in for it.
 */
export function Avatar({ url, size = "small", className }: { url: string | null; size?: keyof typeof SIZES; className?: string }) {
  return (
    <AvatarPrimitive.Root aria-hidden="true" className={cn("block shrink-0 overflow-hidden rounded-full bg-surface-subdued text-placeholder", SIZES[size], className)}>
      {url !== null && <AvatarPrimitive.Image src={url} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={url === null ? 0 : 300} className="block size-full">
        <svg viewBox="0 0 32 32" className="size-full" fill="currentColor">
          <circle cx="16" cy="12.5" r="6" />
          <path d="M4.5 32c0-7.2 5.2-11.5 11.5-11.5S27.5 24.8 27.5 32z" />
        </svg>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
