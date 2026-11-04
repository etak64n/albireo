// A slider, in the way of shadcn/ui, on Radix UI. The arrow keys move it as well as the pointer.

import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden bg-raised">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 cursor-grab border-2 border-primary bg-surface shadow-card transition-transform hover:scale-110 active:cursor-grabbing" />
    </SliderPrimitive.Root>
  );
}
