import { History, House, KeyRound, Layers, LayoutGrid, LogOut, Menu as MenuIcon, Plus, Search, Settings, UserRound, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import appearance from "virtual:albireo-appearance";
import { SEARCH_QUERY_MAX_LENGTH, TITLE_MAX_LENGTH } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useLibrary } from "../library.tsx";
import { cn } from "../lib/utils.ts";
import { Link, navigate, useLocationSearch, usePathname } from "../router.tsx";
import { logOut, useSession } from "../session.tsx";
import { useUploads } from "../uploads.tsx";
import { Avatar } from "./Avatar.tsx";
import { Button } from "./ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/field.tsx";
import { Sheet, SheetClose, SheetContent } from "./ui/sheet.tsx";
import { DropOverlay, UploadButton, UploadPanel } from "./VideoUpload.tsx";

/**
 * The frame of every page: the sidebar of the library on the left, the bar on top with
 * the search, the upload button, and the account, and the page under the bar. On
 * narrow screens the sidebar hides, and the menu button in the bar slides it in from
 * the left. Uploads start from the bar. On the page of a series, they join that series.
 */
export function Shell({ children, seriesId = null }: { children: ReactNode; seriesId?: string | null }) {
  const { setTargetSeries } = useUploads();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Uploads that start on the page of a series join that series.
  useEffect(() => {
    setTargetSeries(seriesId);
    return () => setTargetSeries(null);
  }, [seriesId, setTargetSeries]);

  // Opening a page closes the menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <>
      {/* Keyboard users can jump past the sidebar and the bar. The link shows only while it has focus. */}
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-popover"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar border-r border-hairline bg-surface lg:block">
        <Sidebar />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title="Menu">
          <Sidebar closable />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-sidebar">
        <header className="sticky top-0 z-20 border-b border-hairline bg-surface px-4 sm:px-6 lg:px-gutter">
          <div className="mx-auto flex h-topbar max-w-content items-center gap-2">
            <Button variant="ghost" size="icon" className="-ml-1 lg:hidden" aria-label="Open the menu" onClick={() => setMenuOpen(true)}>
              <MenuIcon />
            </Button>
            <Link to="/" className="mr-1 shrink-0 rounded-xs lg:hidden">
              <img src={appearance.logo} alt={appearance.siteName} className="size-6" />
            </Link>
            <SearchBox />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <UploadButton />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="px-4 pt-6 pb-16 outline-none sm:px-6 lg:px-gutter lg:pt-8">
          <div className="@container mx-auto grid max-w-content gap-12">
            <UploadPanel />
            {children}
          </div>
        </main>
      </div>
      <DropOverlay />
    </>
  );
}

/** The name of the library with its logo, which leads home. */
function Brand() {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 rounded-xs py-1">
      <img src={appearance.logo} alt="" className="size-6 shrink-0" />
      <span className="truncate text-sm font-semibold text-heading">{appearance.siteName}</span>
    </Link>
  );
}

/** The search box on the left of the bar. On the results page it shows the query. */
function SearchBox() {
  const pathname = usePathname();
  const search = useLocationSearch();
  const current = pathname === "/search" ? (new URLSearchParams(search).get("q") ?? "") : "";
  const [query, setQuery] = useState(current);

  useEffect(() => setQuery(current), [current]);

  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:max-w-[360px]"
      onSubmit={(event) => {
        event.preventDefault();
        const words = query.trim();
        if (words !== "") navigate(`/search?q=${encodeURIComponent(words)}`);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subdued" aria-hidden="true" />
      <input
        value={query}
        enterKeyHint="search"
        onChange={(event) => setQuery(event.target.value)}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        placeholder="Search"
        aria-label="Search videos"
        className="h-9 w-full rounded-md bg-surface-subdued pr-3 pl-9 text-sm text-ink placeholder:text-placeholder pointer-coarse:min-h-11 pointer-coarse:text-base"
      />
    </form>
  );
}

/** The menu of the signed-in person under their picture: their channel, its settings, their account, and signing out. */
function AccountMenu() {
  const { me } = useSession();
  const logoutUrl = me.logoutUrl;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account of ${me.displayName}`}
          className="grid cursor-pointer place-items-center rounded-full pointer-coarse:size-11"
        >
          <Avatar url={me.avatarUrl} size="control" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3">
          <Avatar url={me.avatarUrl} />
          <span className="grid min-w-0">
            <span className="truncate text-sm font-semibold text-strong">{me.displayName}</span>
            <span className="truncate text-xs text-subdued">{me.email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(`/users/${me.id}`)}>
          <UserRound />
          Your channel
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings/channel")}>
          <Settings />
          Channel settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings/account")}>
          <KeyRound />
          Account
        </DropdownMenuItem>
        {logoutUrl !== null && (
          <DropdownMenuItem onSelect={() => void logOut(logoutUrl)}>
            <LogOut />
            Log out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The pages of the library and every series. The sidebar on wide screens and the
 * panel that slides in on narrow screens show the same, and the panel can close.
 */
function Sidebar({ closable = false }: { closable?: boolean }) {
  const { series, error } = useLibrary();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-5 pb-6">
      <div className="flex h-topbar shrink-0 items-center justify-between gap-2">
        <Brand />
        {closable && (
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="-mr-1" aria-label="Close the menu">
              <X />
            </Button>
          </SheetClose>
        )}
      </div>
      <nav className="-mx-1 grid gap-0.5" aria-label="Library">
        <NavLink to="/" current={pathname === "/"} icon={<House />}>
          Home
        </NavLink>
        <NavLink to="/videos" current={pathname === "/videos"} icon={<LayoutGrid />}>
          All videos
        </NavLink>
        <NavLink to="/history" current={pathname === "/history"} icon={<History />}>
          History
        </NavLink>
      </nav>
      <div className="grid gap-1">
        <div className="flex h-7 items-center justify-between">
          <h2 className="text-xs text-subdued">Series</h2>
          {!creating && (
            <Button variant="ghost" size="icon" className="-mr-1.5 text-subdued" aria-label="New series" onClick={() => setCreating(true)}>
              <Plus />
            </Button>
          )}
        </div>
        {creating && <NewSeriesForm onDone={() => setCreating(false)} />}
        {error !== "" && <p className="text-xs font-semibold text-critical">{error}</p>}
        {series !== null && series.length > 0 && (
          <nav className="-mx-1 grid gap-0.5" aria-label="Series">
            {series.map((item) => (
              <NavLink key={item.id} to={`/series/${item.id}`} current={pathname === `/series/${item.id}`} icon={<Layers />}>
                {item.title}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

/** A page of the sidebar. The page that is open takes the accent, without a background. */
function NavLink({ to, current, icon, children }: { to: string; current: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      current={current}
      className={cn(
        "flex h-[30px] items-center gap-3 rounded-sm px-2 text-sm transition-colors duration-150 hover:bg-surface-hover pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0",
        current ? "font-semibold text-accent" : "text-strong",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** Creates a series from its title and opens its page. The page edits the description. */
function NewSeriesForm({ onDone }: { onDone: () => void }) {
  const { refresh } = useLibrary();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setSaving(true);
    setError("");
    try {
      const { series } = await api.createSeries({ title, description: "" });
      await refresh();
      onDone();
      navigate(`/series/${series.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form
      className="grid gap-2 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() !== "") void create();
      }}
    >
      <Input value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} aria-label="Series title" placeholder="Series title" autoFocus />
      {error && <p className="text-xs font-semibold text-critical">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving || title.trim() === ""}>
          {saving ? "Creating..." : "Create"}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
