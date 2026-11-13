// Short messages that say how something that someone did went: a success, such as an upload
// that finished, with a green mark, or a failure, with a red mark and the reason. They stack in
// the lower right corner, or along the bottom of a narrow screen. A success goes after 3
// seconds and a failure after 6, but a message stays while the pointer is over it or the
// focus is in it. Screen readers read each one out from a status region. A message can carry a
// link, such as Open on the video that an upload made. The messages take no part in the
// keyboard of dialogs: Escape closes the dialog that is open, not a message.

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n.ts";
import { cn } from "../../lib/utils.ts";
import { Link } from "../../router.tsx";

export interface ToastLink {
  label: string;
  to: string;
}

type ToastKind = "success" | "error";

export interface Toasts {
  /** Says that something went well. */
  success: (message: string, link?: ToastLink) => void;
  /** Says that something failed, and why. */
  error: (message: string) => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  link: ToastLink | undefined;
}

// A message beyond this many pushes the oldest one out.
const MAX_TOASTS = 3;
// A failure stays longer, for its reason to be read.
const DURATION_MS: Record<ToastKind, number> = { success: 3000, error: 6000 };

const ToastContext = createContext<Toasts | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((kind: ToastKind, message: string, link: ToastLink | undefined) => {
    nextId.current += 1;
    const item = { id: nextId.current, kind, message, link };
    setItems((current) => [...current.slice(-(MAX_TOASTS - 1)), item]);
  }, []);
  const toasts = useMemo<Toasts>(
    () => ({ success: (message, link) => show("success", message, link), error: (message) => show("error", message, undefined) }),
    [show],
  );
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  return (
    <ToastContext.Provider value={toasts}>
      {children}
      {/* The region stays on the page, so a screen reader hears each message that joins it. Above the dialogs, so a message that a dialog causes is not under its backdrop. */}
      <div
        role="status"
        aria-label={t.toast.notifications}
        className="pointer-events-none fixed right-4 bottom-4 z-[60] grid w-96 max-w-[calc(100vw-2rem)] gap-2 max-sm:left-4 max-sm:w-auto"
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const t = useT();
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => onDismiss(item.id), DURATION_MS[item.kind]);
    return () => window.clearTimeout(timer);
  }, [held, item.id, item.kind, onDismiss]);

  return (
    <div
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        "pointer-events-auto flex animate-in items-center gap-3 rounded-lg border bg-surface py-2 pr-2 pl-3 text-sm text-strong shadow-popover fade-in-0 slide-in-from-bottom-2 [&>svg]:size-4 [&>svg]:shrink-0",
        item.kind === "success" ? "border-positive/40" : "border-critical/40",
      )}
    >
      {item.kind === "success" ? <CircleCheck aria-hidden="true" className="text-positive" /> : <CircleAlert aria-hidden="true" className="text-critical" />}
      <p className="min-w-0 flex-1 break-words">{item.message}</p>
      {item.link !== undefined && (
        // The message goes when its link opens the page, as the click comes up from the link.
        <span className="shrink-0" onClick={() => onDismiss(item.id)}>
          <Link to={item.link.to} className="rounded-xs font-semibold text-accent hover:underline">
            {item.link.label}
          </Link>
        </span>
      )}
      <button
        type="button"
        aria-label={t.toast.close}
        onClick={() => onDismiss(item.id)}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-sm text-subdued transition-colors duration-150 hover:bg-surface-hover hover:text-strong pointer-coarse:size-11 [&_svg]:size-4"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/** Shows short messages that say how something that someone did went. */
export function useToast(): Toasts {
  const toasts = useContext(ToastContext);
  if (toasts === null) throw new Error("useToast needs a ToastProvider around the page.");
  return toasts;
}
