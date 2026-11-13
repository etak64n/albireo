// A filter of a page: a round pill, 24px high, that shows its name and its value as
// "Name | Value ⌄", and opens a menu of the values under it.

import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./dropdown-menu.tsx";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

/** A filter that chooses one of its values. Filters stand in a row under the title of their page. */
export function Filter<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      {/* The keyboard focus is the ring of the whole app (src/styles.css). On a touch screen the pill grows to be easy to tap. */}
      <DropdownMenuTrigger className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface py-[3px] pr-2 pl-1.5 text-xs font-semibold transition-colors duration-150 hover:bg-surface-hover pointer-coarse:h-9 pointer-coarse:px-3">
        <span className="text-label">{name}</span>
        <span className="h-3 w-px bg-border" aria-hidden="true" />
        <span className="text-accent">{current?.label}</span>
        <ChevronDown className="size-3 text-accent" aria-hidden="true" />
      </DropdownMenuTrigger>
      {/* As wide as its longest value, and never narrower than the filter. */}
      <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
