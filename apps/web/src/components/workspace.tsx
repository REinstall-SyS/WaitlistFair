"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  GraduationCap,
  History,
  Home,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import {
  api,
  type Dashboard,
  type Me,
  type Organization,
  formatDate,
} from "@/lib/api";
import { Overview } from "./overview";
import { Schedules } from "./schedules";
import { Waitlists } from "./waitlists";
import { Offers } from "./offers";
import { HistoryView, OrganizationSettings, Profile } from "./settings";
type AppState = {
  me: Me;
  org: Organization;
  data: Dashboard;
  busy: boolean;
  run: (
    path: string,
    body?: unknown,
    method?: string,
    message?: string,
  ) => Promise<boolean>;
  refresh: () => void;
};
const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const state = useContext(AppContext);
  if (!state) throw new Error("Missing workspace");
  return state;
}
export function Empty({
  title,
  children,
  icon: Icon = CalendarDays,
}: {
  title: string;
  children: React.ReactNode;
  icon?: typeof CalendarDays;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ state }: { state: string }) {
  return (
    <span className={`badge badge-${state}`}>{state.replaceAll("_", " ")}</span>
  );
}
export function Workspace() {
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const [orgID, setOrgID] = useState("");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/me"),
    retry: false,
  });
  const me = meQuery.data;
  const org =
    me?.organizations.find((o) => o.id === orgID) || me?.organizations[0];
  useEffect(() => {
    if (meQuery.isError) router.replace("/login");
  }, [meQuery.isError, router]);
  const dashboard = useQuery({
    queryKey: ["dashboard", org?.id],
    queryFn: () => api<Dashboard>(`/orgs/${org!.id}/dashboard`),
    enabled: !!org,
    refetchInterval: 10000,
  });
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function run(
    path: string,
    body?: unknown,
    method = "POST",
    message = "All set. Your changes are saved.",
  ) {
    if (!me || busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      await api(path, {
        method,
        body,
        csrf: me.user.csrf,
        key: crypto.randomUUID(),
      });
      await client.invalidateQueries();
      setNotice({ text: message, error: false });
      return true;
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!me || meQuery.isPending)
    return (
      <main className="loading-page">
        <Logo />
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" />
        <p>Getting things ready…</p>
      </main>
    );
  if (!org)
    return (
      <main className="center-page">
        <Logo />
        <div className="panel onboarding">
          <h1>A place to grow.</h1>
          <p className="muted">
            Ask your tutoring center to add <strong>{me.user.email}</strong> to
            its organization, or create a center of your own.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await run("/organizations", {
                name: f.get("name"),
                timezone: f.get("timezone"),
              });
            }}
          >
            <label htmlFor="org-name">Tutoring center name</label>
            <input id="org-name" name="name" required maxLength={100} />
            <label htmlFor="org-zone">IANA time zone</label>
            <input
              id="org-zone"
              name="timezone"
              defaultValue="America/Chicago"
              required
            />
            <Button disabled={busy}>Create organization</Button>
          </form>
          {notice && <p role="alert">{notice.text}</p>}
          <Button
            variant="ghost"
            onClick={() =>
              run("/auth/logout").then(() => router.push("/login"))
            }
          >
            Sign out
          </Button>
        </div>
      </main>
    );
  const staff = org.role !== "student";
  const admin = org.role === "admin";
  const nav = staff
    ? [
        { href: "/app", label: "Overview", icon: LayoutDashboard },
        { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
        ...(admin
          ? [
              { href: "/app/waitlist", label: "Waitlists", icon: ListOrdered },
              {
                href: "/app/history",
                label: "Allocation history",
                icon: History,
              },
              {
                href: "/app/organization",
                label: "Organization",
                icon: GraduationCap,
              },
            ]
          : []),
      ]
    : [
        { href: "/app", label: "Home", icon: Home },
        { href: "/app/find", label: "Find appointments", icon: CalendarDays },
        { href: "/app/waitlist", label: "My waitlists", icon: ListOrdered },
        { href: "/app/offers", label: "My offers", icon: Ticket },
        {
          href: "/app/appointments",
          label: "My appointments",
          icon: GraduationCap,
        },
      ];
  const current =
    nav.find((n) => n.href === pathname)?.label ||
    (pathname === "/app/settings" ? "Settings" : "Home");
  const pending =
    dashboard.data?.offers.filter((o) => o.state === "pending").length || 0;
  return (
    <AppContext.Provider
      value={{
        me,
        org,
        data: dashboard.data || {
          server_time: new Date().toISOString(),
          services: [],
          tutors: [],
          slots: [],
          bookings: [],
          waitlist: [],
          offers: [],
        },
        busy,
        run,
        refresh: () => client.invalidateQueries(),
      }}
    >
      <div className="app-shell">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
          <div className="sidebar-brand">
            <Link href="/app" aria-label="WaitlistFair home">
              <Logo />
            </Link>
            <button
              className="mobile-close"
              aria-label="Close navigation"
              onClick={() => setMenu(false)}
            >
              <X />
            </button>
          </div>
          <div className="organization-switch">
            <span className="org-avatar">N</span>
            <div>
              <small>YOUR TUTORING CENTER</small>
              {me.organizations.length > 1 ? (
                <select
                  aria-label="Organization"
                  value={org.id}
                  onChange={(e) => setOrgID(e.target.value)}
                >
                  {me.organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{org.name.split(" · ")[0]}</strong>
              )}
            </div>
            <ChevronDown size={15} />
          </div>
          <p className="nav-section">
            {staff ? "CENTER MANAGEMENT" : "YOUR LEARNING SPACE"}
          </p>
          <nav aria-label="Main navigation">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMenu(false)}
                aria-current={pathname === n.href ? "page" : undefined}
                className={`nav-link ${pathname === n.href ? "active" : ""}`}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.href === "/app/offers" && pending > 0 && (
                  <span className="nav-count">{pending}</span>
                )}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="fairness-note">
              <ShieldCheck size={20} />
              <strong>A clear place in line.</strong>
              <p>
                First come, first served.
                <br />
                Always among eligible students.
              </p>
            </div>
            <Link
              className={`nav-link ${pathname === "/app/settings" ? "active" : ""}`}
              href="/app/settings"
            >
              <Settings size={18} />
              Settings
            </Link>
            <div className="user-profile">
              <span className="avatar">
                {me.user.display_name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{me.user.display_name}</strong>
                <small>
                  {org.role === "admin"
                    ? "Center administrator"
                    : org.role === "tutor"
                      ? "Tutor"
                      : "Student"}
                </small>
              </div>
              <button
                aria-label="Sign out"
                onClick={async () => {
                  if (
                    await run("/auth/logout", undefined, "POST", "Signed out.")
                  ) {
                    client.clear();
                    router.replace("/login");
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        {menu && (
          <button
            className="sidebar-backdrop"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <div className="main-wrap">
          <header className="topbar">
            <div>
              <button
                className="mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMenu(true)}
              >
                <Menu />
              </button>
              <span className="breadcrumb">
                Your workspace <span>/</span> <strong>{current}</strong>
              </span>
            </div>
            <div className="topbar-right">
              <span className="today-label">
                {formatDate(new Date().toISOString(), me.user.timezone)}
              </span>
              <span className="badge badge-soft">
                <span className="status-dot" />
                {staff ? "Center workspace" : "Student workspace"}
              </span>
            </div>
          </header>
          {org.demo && (
            <div className="demo-banner">
              <Sparkles size={14} />
              <span>
                Demonstration center · All people and appointments are
                fictional.
              </span>
              {process.env.NEXT_PUBLIC_DEMO === "true" && (
                <a
                  href="http://localhost:8025"
                  target="_blank"
                  rel="noreferrer"
                >
                  Mailpit inbox <ArrowRight size={13} />
                </a>
              )}
            </div>
          )}
          <main id="main" className="main-content">
            {notice && (
              <div
                role={notice.error ? "alert" : "status"}
                className={notice.error ? "notice notice-error" : "notice"}
              >
                {notice.text}
                <button
                  aria-label="Dismiss notification"
                  onClick={() => setNotice(null)}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {dashboard.isError ? (
              <div className="error-box" role="alert">
                {dashboard.error.message}
                <Button variant="outline" onClick={() => dashboard.refetch()}>
                  Try again
                </Button>
              </div>
            ) : dashboard.isPending ? (
              <>
                <div className="skeleton skeleton-title" />
                <div className="stat-grid">
                  {[1, 2, 3].map((x) => (
                    <div key={x} className="skeleton skeleton-card" />
                  ))}
                </div>
              </>
            ) : pathname === "/app/find" ||
              pathname === "/app/calendar" ||
              pathname === "/app/appointments" ? (
              <Schedules mode={pathname.split("/").pop()!} />
            ) : pathname === "/app/waitlist" ? (
              <Waitlists />
            ) : pathname === "/app/offers" ? (
              <Offers />
            ) : pathname === "/app/history" ? (
              <HistoryView />
            ) : pathname === "/app/organization" ? (
              <OrganizationSettings />
            ) : pathname === "/app/settings" ? (
              <Profile />
            ) : (
              <Overview />
            )}
          </main>
          <footer className="app-footer">
            <span>WaitlistFair · More opportunity. Less waiting.</span>
            <Link href="/privacy">Privacy & data</Link>
          </footer>
        </div>
      </div>
    </AppContext.Provider>
  );
}
