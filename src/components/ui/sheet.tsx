// A panel that slides over the page from the left, in the way of shadcn/ui, on the Radix
// UI dialog. Radix keeps the focus inside while it is open, closes it on Escape and on a
// click outside, and gives the focus back to the button that opened it.

import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({
  className,
  title,
  children,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & {
  /** The name of the panel for screen readers. It is not shown. */
  title: string;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        aria-describedby={undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-[264px] flex-col border-r border-line bg-surface shadow-lift",
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=closed]:duration-200",
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
