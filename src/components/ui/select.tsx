// A field that chooses one of its options: it looks like
// a text field, 28px high, with the chosen option and an arrow, and opens a menu of the
// options under it. A menu of more than 10 options has a search field at its top, so that a
// long list, such as the series of a large library, stays quick to choose from.

import { ChevronDown } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n.ts";
import { cn } from "../../lib/utils.ts";

/** A menu of more options than this has a search field at its top. */
export const SEARCH_ABOVE = 10;

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** The language of the label, when it is not the language of the page. */
  lang?: string;
}

/** The text to search: without case, and with the full-width and half-width forms alike. */
export function searchable(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * A field that chooses one of its options from a menu. The menu opens under the field, as
 * wide as its longest option and never narrower than the field, and shows the chosen option
 * on the subtle accent. The arrow keys walk the options, Enter chooses one, and Escape closes
 * the menu without a change.
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The option that Enter chooses: the one under the pointer, or the one that the arrow keys reached.
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const withSearch = options.length > SEARCH_ABOVE;
  const current = options.find((option) => option.value === value);

  const shown = useMemo(() => {
    const words = searchable(query.trim());
    return words === "" ? options : options.filter((option) => searchable(option.label).includes(words));
  }, [options, query]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      // The menu opens on the chosen option, with the whole list.
      setQuery("");
      setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    }
  }

  function choose(option: SelectOption<T>) {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  }

  function optionElement(index: number): Element | null | undefined {
    return listRef.current?.querySelector(`[data-index="${index}"]`);
  }

  function moveTo(index: number) {
    if (shown.length === 0) return;
    const next = Math.min(Math.max(index, 0), shown.length - 1);
    setActive(next);
    optionElement(next)?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown") moveTo(active + 1);
    else if (event.key === "ArrowUp") moveTo(active - 1);
    // In the search field, Home and End move in the text.
    else if (event.key === "Home" && !withSearch) moveTo(0);
    else if (event.key === "End" && !withSearch) moveTo(shown.length - 1);
    else if (event.key === "Enter") {
      const option = shown[active];
      if (option !== undefined) choose(option);
    } else return;
    event.preventDefault();
  }

  const activeId = shown[active] === undefined ? undefined : `${listId}-${active}`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={changeOpen}>
      <PopoverPrimitive.Trigger
        id={id}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        // The arrow keys open the menu, as they open a select of the browser.
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          changeOpen(true);
        }}
        className={cn(
          "field flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-default",
          // While the menu is open, the field keeps the ring of a field in use, unless the
          // search field of the menu has it: one ring shows where the keys go.
          !withSearch && "data-[state=open]:outline-4 data-[state=open]:outline-solid data-[state=open]:outline-[color:var(--theme-focus-ring)]",
          className,
        )}
      >
        <span className="min-w-0 truncate" lang={current?.lang}>
          {current?.label}
        </span>
        <ChevronDown className="size-4 shrink-0 text-subdued" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          // The search field takes the keys when the menu has one, and the list otherwise.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (withSearch ? searchRef.current : listRef.current)?.focus();
            optionElement(active)?.scrollIntoView({ block: "nearest" });
          }}
          className={cn(
            "z-50 flex max-h-[min(24rem,var(--radix-popover-content-available-height))] max-w-[min(32rem,var(--radix-popover-content-available-width))] min-w-[var(--radix-popover-trigger-width)] flex-col gap-1 overflow-hidden rounded-md bg-surface p-1 text-strong shadow-popover",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {withSearch && (
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                listRef.current?.scrollTo({ top: 0 });
              }}
              onKeyDown={onKeyDown}
              placeholder={t.shell.search}
              aria-label={t.shell.search}
              aria-controls={listId}
              aria-activedescendant={activeId}
              autoComplete="off"
              className="field shrink-0"
            />
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={withSearch ? undefined : -1}
            aria-activedescendant={withSearch ? undefined : activeId}
            onKeyDown={withSearch ? undefined : onKeyDown}
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto outline-none"
          >
            {shown.map((option, index) => {
              const chosen = option.value === value;
              return (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={chosen}
                  lang={option.lang}
                  onPointerMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex min-h-7 shrink-0 cursor-pointer items-center rounded-xs px-2 py-1 text-sm select-none pointer-coarse:min-h-11",
                    // The chosen option keeps its accent under the pointer, as in the menus of the app.
                    chosen ? "bg-accent-subtle text-accent" : index === active && "bg-surface-hover",
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                </div>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
