import { History, House, Layers, LayoutGrid, LogOut, Menu as MenuIcon, Plus, Search, Settings, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import appearance from "virtual:albireo-appearance";
import { SEARCH_QUERY_MAX_LENGTH, TITLE_MAX_LENGTH } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useLibrary } from "../library.tsx";
import { Link, navigate, useLocationSearch, usePathname } from "../router.tsx";
import { useSession } from "../session.tsx";
import { useUploads } from "../uploads.tsx";
import { Avatar } from "./Avatar.tsx";
import { Button } from "./ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/field.tsx";
import { Sheet, SheetClose, SheetContent } from "./ui/sheet.tsx";
import { DropOverlay, UploadButton, UploadPanel } from "./VideoUpload.tsx";

/**
 * The frame of every page: the header on top, the page below it, and the menu that
 * the button in the upper left corner opens over the page, as on YouTube.
 * Uploads start from the header. On the page of a series, they join that series.
 */
export function Shell({ children, seriesId = null }: { children: ReactNode; seriesId?: string | null }) {
  const { setTargetSeries } = useUploads();
  const [menuOpen, setMenuOpen] = useState(false);

  // Uploads that start on the page of a series join that series.
  useEffect(() => {
    setTargetSeries(seriesId);
    return () => setTargetSeries(null);
  }, [seriesId, setTargetSeries]);
  const pathname = usePathname();

  // Opening a page closes the menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      {/* Keyboard users can jump past the header. The link shows only while it has focus. */}
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:font-bold focus:shadow-lift"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="flex h-14 items-center justify-between gap-3 px-2 sm:px-4">
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="icon-lg" aria-label="Open the menu" onClick={() => setMenuOpen(true)}>
              <MenuIcon />
            </Button>
            <Brand nameClassName="max-sm:hidden" />
          </div>
          <SearchBox />
          <div className="flex shrink-0 items-center gap-2">
            <UploadButton />
            <AccountMenu />
          </div>
        </div>
      </header>
      <SheetContent title="Menu">
        <MenuPanel />
      </SheetContent>
      <main id="main" tabIndex={-1} className="mx-auto grid max-w-[1280px] gap-8 px-4 py-6 outline-none sm:px-6 lg:px-8">
        <UploadPanel />
        {children}
      </main>
      <DropOverlay />
    </Sheet>
  );
}

function Brand({ nameClassName = "" }: { nameClassName?: string }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 px-1 py-1">
      <img src={appearance.logo} alt="" className="size-7 shrink-0 rounded-ui" />
      <span className={`truncate font-heading text-lg font-bold tracking-tight text-heading ${nameClassName}`}>{appearance.siteName}</span>
    </Link>
  );
}

/** The search box in the middle of the header. On the results page it shows the query. */
function SearchBox() {
  const pathname = usePathname();
  const search = useLocationSearch();
  const current = pathname === "/search" ? (new URLSearchParams(search).get("q") ?? "") : "";
  const [query, setQuery] = useState(current);

  useEffect(() => setQuery(current), [current]);

  return (
    <form
      role="search"
      className="flex min-w-0 max-w-xl flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        const words = query.trim();
        if (words !== "") navigate(`/search?q=${encodeURIComponent(words)}`);
      }}
    >
      <Input
        value={query}
        enterKeyHint="search"
        onChange={(event) => setQuery(event.target.value)}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        placeholder="Search"
        aria-label="Search videos"
        className="h-9 min-w-0 flex-1"
      />
      <Button type="submit" variant="secondary" aria-label="Search" className="h-9 w-12 shrink-0 -ml-px px-0">
        <Search />
      </Button>
    </form>
  );
}

/** The menu of the signed-in person under their picture: their page, the profile settings, and signing out. */
function AccountMenu() {
  const { me } = useSession();
  const logoutUrl = me.logoutUrl;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account of ${me.displayName}`}
          className="block cursor-pointer rounded-full p-0.5 transition duration-150 hover:bg-raised pointer-coarse:p-1.5"
        >
          <Avatar url={me.avatarUrl} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3">
          <Avatar url={me.avatarUrl} />
          <span className="grid min-w-0">
            <span className="truncate text-[13px] font-bold text-heading">{me.displayName}</span>
            <span className="truncate text-xs font-normal text-muted">{me.email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(`/users/${me.id}`)}>
          <UserRound />
          Your page
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings />
          Profile settings
        </DropdownMenuItem>
        {logoutUrl !== null && (
          <DropdownMenuItem onSelect={() => window.location.assign(logoutUrl)}>
            <LogOut />
            Log out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The lists of the library and every series, in the menu over the left side of the page. */
function MenuPanel() {
  const { series, error } = useLibrary();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-2 pb-4 sm:px-3">
      {/* The same button and name as in the header, so the menu closes from where it opened.
          The row trades the padding of the menu for the padding of the header. */}
      <div className="-mx-2 flex h-14 shrink-0 items-center gap-1.5 px-2 sm:-mx-3 sm:px-4">
        <SheetClose asChild>
          <Button variant="ghost" size="icon-lg" aria-label="Close the menu">
            <MenuIcon />
          </Button>
        </SheetClose>
        <Brand />
      </div>
      <nav className="grid gap-0.5" aria-label="Library">
        <MenuLink to="/" current={pathname === "/"} icon={<House />}>
          Home
        </MenuLink>
        <MenuLink to="/videos" current={pathname === "/videos"} icon={<LayoutGrid />}>
          All videos
        </MenuLink>
        <MenuLink to="/history" current={pathname === "/history"} icon={<History />}>
          History
        </MenuLink>
      </nav>
      <section className="grid gap-0.5 border-t border-line pt-4" aria-label="Series">
        <div className="flex items-center justify-between pr-0.5 pb-1 pl-3">
          <h2 className="text-[11px] font-bold tracking-wider text-muted uppercase">Series</h2>
          {!creating && (
            <Button variant="ghost" size="icon" className="size-7" aria-label="New series" onClick={() => setCreating(true)}>
              <Plus />
            </Button>
          )}
        </div>
        {creating && <NewSeriesForm onDone={() => setCreating(false)} />}
        {error !== "" && <p className="px-3 text-xs font-bold text-danger">{error}</p>}
        {series?.map((item) => (
          <MenuLink key={item.id} to={`/series/${item.id}`} current={pathname === `/series/${item.id}`} icon={<Layers />}>
            {item.title}
          </MenuLink>
        ))}
      </section>
    </div>
  );
}

function MenuLink({ to, current, icon, children }: { to: string; current: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      current={current}
      className={`flex items-center gap-3 rounded-ui px-3 py-2 text-[13px] font-bold transition duration-150 pointer-coarse:py-3 [&_svg]:size-[18px] [&_svg]:shrink-0 ${
        current ? "bg-raised text-heading [&_svg]:text-accent" : "text-muted hover:bg-raised/70 hover:text-ink"
      }`}
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
      className="grid gap-2 px-1 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() !== "") void create();
      }}
    >
      <Input
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Series title"
        placeholder="Series title"
        autoFocus
        className="h-8"
      />
      {error && <p className="text-xs font-bold text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving || title.trim() === ""}>
          {saving ? "Creating..." : "Create"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
