import { Copy, Ellipsis, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Invitation, Person } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu.tsx";
import { Select } from "../components/ui/select.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { useT } from "../i18n.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

// The head and the cells of the tables, as in the table of a series.
const HEAD = "h-9 px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-label";
const CELL = "px-2 py-3 align-middle";

/**
 * The people who may sign in and the invitations that nobody has used yet. Admins change who
 * is an admin, remove people, and make the links that let someone join. Others see that the
 * page is for admins.
 */
export function PeoplePage() {
  const { me } = useSession();
  const t = useT();
  usePageTitle(t.people.people);
  return (
    <Shell>
      <PageHeader title={t.people.people} />
      {me.isAdmin ? (
        <div className="grid w-full max-w-[960px] gap-12">
          <PeopleSection />
          <InvitationsSection />
        </div>
      ) : (
        <p className="text-sm text-label">{t.people.adminsOnly}</p>
      )}
    </Shell>
  );
}

function PeopleSection() {
  const { me, setMe } = useSession();
  const t = useT();
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Person | null>(null);

  useEffect(() => {
    let active = true;
    api.listPeople().then(
      (loaded) => {
        if (active) setPeople(loaded.people);
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function setAdmin(person: Person, isAdmin: boolean) {
    try {
      const { person: changed } = await api.updatePerson(person.id, { isAdmin });
      setPeople((current) => current?.map((other) => (other.id === changed.id ? changed : other)) ?? null);
      // An admin who makes themselves a member loses this page, which the session then shows.
      if (changed.id === me.id) setMe((await api.getMe()).me);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(person: Person) {
    await api.removePerson(person.id);
    setPeople((current) => current?.filter((other) => other.id !== person.id) ?? null);
    setRemoving(null);
  }

  // The table goes right under the title of the page, which names it already.
  return (
    <div className="grid min-w-0 content-start gap-4">
      {error !== "" ? (
        <p className="error-box">{error}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={HEAD}>{t.people.name}</th>
              <th className={`${HEAD} max-sm:hidden`}>{t.people.email}</th>
              <th className={HEAD}>{t.people.role}</th>
              <th className={`${HEAD} max-lg:hidden`}>{t.people.joined}</th>
              <th className={`${HEAD} max-md:hidden`}>{t.people.lastActive}</th>
              <th className={HEAD}>
                <span className="sr-only">{t.people.actionsOf("")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people === null ? (
              <tr className="border-b border-hairline">
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={`${CELL} max-sm:hidden`}>
                  <Skeleton className="h-5 w-40" />
                </td>
                <td className={CELL}>
                  <Skeleton className="h-5 w-16" />
                </td>
                <td className={`${CELL} max-lg:hidden`}>
                  <Skeleton className="h-5 w-24" />
                </td>
                <td className={`${CELL} max-md:hidden`}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={CELL} />
              </tr>
            ) : (
              people.map((person) => (
                <tr key={person.id} className="group border-b border-hairline">
                  <td className={CELL}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar url={person.avatarUrl} size="tiny" />
                      <Link to={`/users/${person.id}`} className="truncate font-semibold text-strong hover:underline">
                        {person.displayName}
                      </Link>
                      {person.id === me.id && (
                        <span className="rounded-xs border border-border bg-surface-subdued px-1.5 text-xs leading-[18px] text-label">
                          {t.people.you}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`${CELL} break-all text-strong max-sm:hidden`}>{person.email}</td>
                  <td className={`${CELL} text-strong`}>{person.isAdmin ? t.account.admin : t.account.member}</td>
                  <td className={`${CELL} text-strong max-lg:hidden`}>{formatDate(person.joinedAt)}</td>
                  <td className={`${CELL} text-strong max-md:hidden`}>
                    {person.lastActiveAt === null ? "—" : formatDateTime(person.lastActiveAt)}
                  </td>
                  <td className={`${CELL} text-right`}>
                    <PersonMenu
                      person={person}
                      self={person.id === me.id}
                      onSetAdmin={(isAdmin) => void setAdmin(person, isAdmin)}
                      onRemove={() => setRemoving(person)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t.people.removeQuestion(removing?.displayName ?? "")}
        confirmLabel={t.people.remove}
        onConfirm={async () => {
          if (removing !== null) await remove(removing);
        }}
        onClose={() => setRemoving(null)}
      >
        {t.people.removeKeepsContent}
      </ConfirmDialog>
    </div>
  );
}

/** The actions on a person: the other role, and removal, which an admin cannot do to themselves. */
function PersonMenu({
  person,
  self,
  onSetAdmin,
  onRemove,
}: {
  person: Person;
  self: boolean;
  onSetAdmin: (isAdmin: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.people.actionsOf(person.displayName)}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {person.isAdmin ? (
          <DropdownMenuItem onSelect={() => onSetAdmin(false)}>
            <ShieldOff />
            {t.people.makeMember}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onSetAdmin(true)}>
            <ShieldCheck />
            {t.people.makeAdmin}
          </DropdownMenuItem>
        )}
        {!self && (
          <DropdownMenuItem onSelect={onRemove}>
            <UserMinus />
            {t.people.remove}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The address of the page of an invitation, on this albireo. */
function joinLink(token: string): string {
  return new URL(`${import.meta.env.BASE_URL}join/${token}`, window.location.origin).href;
}

/**
 * The link of a new invitation, which albireo shows only once, and the invitations that nobody
 * has used yet, which an admin can delete.
 */
function InvitationsSection() {
  const t = useT();
  const toast = useToast();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listInvitations().then(
      (loaded) => setInvitations(loaded.invitations),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  useEffect(load, [load]);

  async function create() {
    setCreating(true);
    try {
      const created = await api.createInvitation({ isAdmin: role === "admin" });
      setLink(joinLink(created.token));
      setInvitations((current) => [created.invitation, ...(current ?? [])]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t.people.copied);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(invitation: Invitation) {
    try {
      await api.deleteInvitation(invitation.id);
      setInvitations((current) => current?.filter((other) => other.id !== invitation.id) ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Section
      title={t.people.invitations}
      actions={
        <>
          <Select
            value={role}
            options={[
              { value: "member", label: t.account.member },
              { value: "admin", label: t.account.admin },
            ]}
            onChange={setRole}
            aria-label={t.people.inviteAs}
            className="w-fit"
          />
          <Button variant="primary" disabled={creating} onClick={() => void create()}>
            {t.people.createLink}
          </Button>
        </>
      }
    >
      {link !== null && (
        <div className="grid gap-2 rounded-sm border border-border bg-surface-subdued p-3">
          <p className="text-sm font-semibold text-strong">{t.people.newLink}</p>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-sm text-strong">{link}</code>
            <Button size="sm" onClick={() => void copy(link)}>
              <Copy />
              {t.people.copy}
            </Button>
          </div>
          <p className="text-xs text-label">{t.people.newLinkNote}</p>
        </div>
      )}
      {error !== "" ? (
        <p className="error-box">{error}</p>
      ) : invitations !== null && invitations.length === 0 ? (
        <p className="text-sm text-label">{t.people.noInvitations}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={HEAD}>{t.people.role}</th>
              <th className={HEAD}>{t.people.invitedBy}</th>
              <th className={`${HEAD} max-md:hidden`}>{t.people.created}</th>
              <th className={HEAD}>{t.people.expires}</th>
              <th className={HEAD}>
                <span className="sr-only">{t.people.deleteInvitation}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invitations === null ? (
              <tr className="border-b border-hairline">
                <td className={CELL}>
                  <Skeleton className="h-5 w-16" />
                </td>
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={`${CELL} max-md:hidden`}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={CELL}>
                  <Skeleton className="h-5 w-32" />
                </td>
                <td className={CELL} />
              </tr>
            ) : (
              invitations.map((invitation) => (
                <tr key={invitation.id} className="border-b border-hairline">
                  <td className={`${CELL} text-strong`}>{invitation.isAdmin ? t.account.admin : t.account.member}</td>
                  <td className={CELL}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar url={invitation.invitedBy.avatarUrl} size="tiny" />
                      <span className="truncate text-strong">{invitation.invitedBy.displayName}</span>
                    </span>
                  </td>
                  <td className={`${CELL} text-strong max-md:hidden`}>{formatDateTime(invitation.createdAt)}</td>
                  <td className={`${CELL} text-strong`}>{formatDateTime(invitation.expiresAt)}</td>
                  <td className={`${CELL} text-right`}>
                    <Button size="sm" onClick={() => void remove(invitation)}>
                      {t.people.deleteInvitation}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </Section>
  );
}
