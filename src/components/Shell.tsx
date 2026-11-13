import {
  ArrowRight,
  History,
  House,
  KeyRound,
  Layers,
  LayoutGrid,
  ListVideo,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import appearance from "virtual:albireo-appearance";
import { SEARCH_QUERY_MAX_LENGTH, TITLE_MAX_LENGTH } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useT } from "../i18n.ts";
import { useLibrary } from "../library.tsx";
import { cn } from "../lib/utils.ts";
import { Link, navigate, useLocationSearch, usePathname } from "../router.tsx";
import { useSession } from "../session.tsx";
import { useUploads } from "../uploads.tsx";
import { Avatar } from "./Avatar.tsx";
import { Logo } from "./Logo.tsx";
import { Button } from "./ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Input, Label } from "./ui/field.tsx";
import { Sheet, SheetClose, SheetContent } from "./ui/sheet.tsx";
import { useToast } from "./ui/toast.tsx";
import { DropOverlay, UploadPanel } from "./VideoUpload.tsx";

/**
 * The frame of every page: the sidebar of the library on the left, with the upload page
 * among its pages, the bar on top with the search and the account, and the page under the
 * bar. On narrow screens the sidebar hides, and the menu button in the bar slides it in from
 * the left. Videos dropped on any page join the upload queue, and on the page of a series
 * they join that series.
 */
export function Shell({
  children,
  seriesId = null,
  uploadPage = false,
}: {
  children: ReactNode;
  seriesId?: string | null;
  /** The upload page, which shows the queue and the place to drop videos itself. */
  uploadPage?: boolean;
}) {
  const { setTargetSeries } = useUploads();
  const t = useT();
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
        {t.shell.skipToContent}
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar border-r border-hairline bg-surface lg:block">
        <Sidebar />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title={t.shell.menu}>
          <Sidebar closable />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-sidebar">
        <header className="sticky top-0 z-20 border-b border-hairline bg-surface px-4 sm:px-6 lg:px-gutter">
          <div className="mx-auto flex h-topbar max-w-content items-center gap-2">
            <Button variant="ghost" size="icon" className="-ml-1 lg:hidden" aria-label={t.shell.openMenu} onClick={() => setMenuOpen(true)}>
              <MenuIcon />
            </Button>
            <Link to="/" className="mr-1 shrink-0 rounded-xs lg:hidden">
              <Logo alt={appearance.siteName} className="size-8" />
            </Link>
            <SearchBox />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <AccountMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="px-4 pt-6 pb-16 outline-none sm:px-6 lg:px-gutter lg:pt-8">
          <div className="@container mx-auto grid max-w-content gap-12">
            {!uploadPage && <UploadPanel />}
            {children}
          </div>
        </main>
      </div>
      {!uploadPage && <DropOverlay />}
    </>
  );
}

/** The name of the library with its logo, which leads home. */
function Brand() {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 rounded-xs py-1">
      <Logo alt="" className="size-8 shrink-0" />
      <span className="truncate text-base font-semibold text-heading">{appearance.siteName}</span>
    </Link>
  );
}

/** The search box on the left of the bar. On the results page it shows the query. */
function SearchBox() {
  const t = useT();
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
        placeholder={t.shell.search}
        aria-label={t.shell.search}
        className="h-9 w-full rounded-md bg-surface-subdued pr-3 pl-9 text-sm text-ink placeholder:text-placeholder pointer-coarse:min-h-11 pointer-coarse:text-base"
      />
    </form>
  );
}

/**
 * The menu of the signed-in person under their picture: their channel, its settings, their
 * account, the people of albireo for admins, and logging out.
 */
function AccountMenu() {
  const { me, signOut } = useSession();
  const t = useT();
  const toast = useToast();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.shell.accountOf(me.displayName)}
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
          {t.shell.yourChannel}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings/channel")}>
          <Settings />
          {t.common.channelSettings}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings/account")}>
          <KeyRound />
          {t.common.account}
        </DropdownMenuItem>
        {me.isAdmin && (
          <DropdownMenuItem onSelect={() => navigate("/settings/people")}>
            <Users />
            {t.shell.people}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut().catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))}>
          <LogOut />
          {t.shell.logOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Each group of the sidebar lists this many, the ones changed last, so the sidebar stays short
// however many there are. Show all under them opens the page that lists every one.
const SIDEBAR_ITEMS = 5;

/** A row after the items of a group in the sidebar: an action, quieter than the pages. */
const SIDEBAR_ACTION =
  "-mx-1 flex h-[30px] items-center gap-3 rounded-sm px-2 text-sm text-subdued transition-colors duration-150 hover:bg-surface-hover hover:text-strong pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * The pages of the library, every series, and the playlists of the person, the ones
 * changed last first. The sidebar on wide screens and the panel that slides in on narrow
 * screens show the same, and the panel can close.
 */
function Sidebar({ closable = false }: { closable?: boolean }) {
  const { series, playlists, error } = useLibrary();
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-5 pb-6">
      <div className="flex h-topbar shrink-0 items-center justify-between gap-2">
        <Brand />
        {closable && (
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="-mr-1" aria-label={t.shell.closeMenu}>
              <X />
            </Button>
          </SheetClose>
        )}
      </div>
      <nav className="-mx-1 grid gap-0.5" aria-label={t.shell.library}>
        <NavLink to="/" current={pathname === "/"} icon={<House />}>
          {t.shell.home}
        </NavLink>
        <NavLink to="/videos" current={pathname === "/videos"} icon={<LayoutGrid />}>
          {t.common.allVideos}
        </NavLink>
        <NavLink to="/history" current={pathname === "/history"} icon={<History />}>
          {t.shell.history}
        </NavLink>
        <NavLink to="/upload" current={pathname === "/upload"} icon={<Upload />}>
          {t.upload.upload}
        </NavLink>
      </nav>
      {error !== "" && <p className="text-xs font-semibold text-critical">{error}</p>}
      <SidebarGroup
        heading={t.common.series}
        listPath="/series"
        items={series}
        pathOf={(id) => `/series/${id}`}
        icon={<Layers />}
        newLabel={t.shell.newSeries}
        titleLabel={t.shell.seriesTitle}
        create={async (title) => `/series/${(await api.createSeries({ title, description: "" })).series.id}`}
      />
      <SidebarGroup
        heading={t.common.playlists}
        listPath="/playlists"
        items={playlists}
        pathOf={(id) => `/playlists/${id}`}
        icon={<ListVideo />}
        newLabel={t.shell.newPlaylist}
        titleLabel={t.shell.playlistTitle}
        create={async (title) => `/playlists/${(await api.createPlaylist({ title, description: "" })).playlist.id}`}
      />
    </div>
  );
}

/**
 * A group of the sidebar, the series or the playlists: the 5 changed last under its heading,
 * Show all, which opens the page that lists every one, and a last row that opens a dialog for
 * a new one.
 */
function SidebarGroup({
  heading,
  listPath,
  items,
  pathOf,
  icon,
  newLabel,
  titleLabel,
  create,
}: {
  heading: string;
  /** The page that lists every one, which Show all opens. */
  listPath: string;
  /** Null until the library loads. */
  items: { id: string; title: string }[] | null;
  pathOf: (id: string) => string;
  icon: ReactNode;
  newLabel: string;
  titleLabel: string;
  /** Makes a new one with the title and returns the path of its page. */
  create: (title: string) => Promise<string>;
}) {
  const t = useT();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const listed = items?.slice(0, SIDEBAR_ITEMS) ?? null;

  return (
    <div className="grid gap-1">
      <h2 className="flex h-7 items-center text-xs text-subdued">{heading}</h2>
      {listed !== null && listed.length > 0 && (
        <nav className="-mx-1 grid gap-0.5" aria-label={heading}>
          {listed.map((item) => (
            <NavLink key={item.id} to={pathOf(item.id)} current={pathname === pathOf(item.id)} icon={icon}>
              {item.title}
            </NavLink>
          ))}
        </nav>
      )}
      <Link to={listPath} current={pathname === listPath} className={cn(SIDEBAR_ACTION, pathname === listPath && "font-semibold text-accent")}>
        <ArrowRight aria-hidden="true" />
        <span className="truncate">{t.shell.showAll}</span>
      </Link>
      <button type="button" onClick={() => setCreating(true)} className={SIDEBAR_ACTION}>
        <Plus aria-hidden="true" />
        <span className="truncate">{newLabel}</span>
      </button>
      <NewItemDialog open={creating} heading={newLabel} titleLabel={titleLabel} create={create} onClose={() => setCreating(false)} />
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

/**
 * The dialog that makes a series or a playlist from its title and opens its page, where its
 * description is edited. A dialog that opens again starts empty.
 */
function NewItemDialog({
  open,
  heading,
  titleLabel,
  create,
  onClose,
}: {
  open: boolean;
  heading: string;
  titleLabel: string;
  create: (title: string) => Promise<string>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{heading}</DialogTitle>
        {open && <NewItemForm titleLabel={titleLabel} create={create} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function NewItemForm({ titleLabel, create, onDone }: { titleLabel: string; create: (title: string) => Promise<string>; onDone: () => void }) {
  const { refresh } = useLibrary();
  const toast = useToast();
  const t = useT();
  const fieldId = useId();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const path = await create(title);
      await refresh();
      onDone();
      navigate(path);
      toast.success(t.toast.created(title.trim()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() !== "") void submit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={fieldId}>{titleLabel}</Label>
        <Input id={fieldId} value={title} maxLength={TITLE_MAX_LENGTH} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button>{t.common.cancel}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={saving || title.trim() === ""}>
          {saving ? t.shell.creating : t.shell.create}
        </Button>
      </div>
    </form>
  );
}
