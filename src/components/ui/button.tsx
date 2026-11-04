// The button of the app, in the way of shadcn/ui: one component with variants and sizes.
// asChild renders the look on its child instead, such as a link that looks like a button.

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-ui font-bold whitespace-nowrap transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-45 pointer-coarse:min-h-11 pointer-coarse:min-w-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-lift",
        secondary: "border border-line bg-surface text-heading hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lift",
        ghost: "text-heading hover:bg-raised",
        danger: "bg-danger text-white hover:-translate-y-0.5 hover:shadow-lift",
      },
      size: {
        sm: "h-7 px-3 text-xs",
        md: "h-8 px-3.5 text-[13px]",
        lg: "h-9 px-4 text-[13px]",
        icon: "size-8",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      data-slot="button"
      // A button outside a form does nothing on its own, so it is never a submit button unless asked.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
