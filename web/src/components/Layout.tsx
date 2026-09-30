import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { isAdmin, staff, useLogout, useMe, useMeta, useUnread } from "../api/auth";
import { Loading } from "./ui";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

/** Offers "Install app" where the browser supports it (Chrome, Edge, Android). */
function useInstallPrompt() {
  const [evt, setEvt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  return evt ? () => void evt.prompt().finally(() => setEvt(null)) : null;
}

const Count = ({ n }: { n?: number }) => (n ? <span className="count" aria-label={`${n} new`}>{n > 99 ? "99+" : n}</span> : null);

/** Site shell: top bar on wide screens, tab bar at the bottom on phones. Pages are public unless wrapped in RequireUser. */
export function Layout() {
  const me = useMe();
  const meta = useMeta();
  const user = me.data ?? null;
  const unread = useUnread(!!user);
  const logout = useLogout();
  const install = useInstallPrompt();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const site = meta.data?.settings.siteName ?? "";
  const u = unread.data;
  const modCount = (u?.reviewQueue ?? 0) + (u?.openReports ?? 0);

  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="appbar">
        <div className="appbar-inner">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>{site}</span>
          </Link>
          <nav className="nav hide-narrow" aria-label="Main">
            <NavLink to="/" end>Buy</NavLink>
            <NavLink to="/sell">Sell</NavLink>
            {user && (
              <NavLink to="/saved">
                Saved <Count n={u?.savedSearchMatches} />
              </NavLink>
            )}
            {user && (
              <NavLink to="/messages">
                Messages <Count n={u?.messages} />
              </NavLink>
            )}
            {staff(user) && (
              <NavLink to="/moderation">
                Moderation <Count n={modCount} />
              </NavLink>
            )}
            {isAdmin(user) && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <span className="spacer" />
          {install && (
            <button className="btn btn-sm" onClick={install}>
              Install app
            </button>
          )}
          {me.isPending ? null : user ? (
            <div className="user small hide-narrow">
              <NavLink to="/account">{user.name}</NavLink>
              <button className="btn btn-sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="user small">
              <Link to="/login" className="btn btn-sm">Sign in</Link>
              <Link to="/register" className="btn btn-sm btn-primary hide-narrow">Join</Link>
            </div>
          )}
        </div>
      </header>
      {!online && <div className="offline" role="status">You're offline. Recently viewed cars are still available.</div>}
      <main id="main">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer muted small hide-narrow">
        {site} · <Link to="/safety">Buying safely</Link> · <a href="/sitemap.xml">Sitemap</a>
      </footer>
      <nav className="tabbar show-narrow" aria-label="Main">
        <NavLink to="/" end><span aria-hidden>🔍</span>Buy</NavLink>
        <NavLink to="/saved"><span aria-hidden>♡</span>Saved<Count n={u?.savedSearchMatches} /></NavLink>
        <NavLink to="/sell"><span aria-hidden>＋</span>Sell</NavLink>
        <NavLink to="/messages"><span aria-hidden>✉</span>Messages<Count n={u?.messages} /></NavLink>
        {staff(user) ? (
          <NavLink to="/moderation"><span aria-hidden>⚑</span>Moderate<Count n={modCount} /></NavLink>
        ) : (
          <NavLink to={user ? "/account" : "/login"}><span aria-hidden>☺</span>{user ? "Account" : "Sign in"}</NavLink>
        )}
      </nav>
    </>
  );
}

/** Sends visitors to sign in first, then back here. */
export function RequireUser({ children, role }: { children: ReactNode; role?: "staff" | "admin" }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isPending) return <Loading />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (role === "staff" && !staff(me.data)) return <div className="wrap"><div className="notice">This page is for moderators.</div></div>;
  if (role === "admin" && !isAdmin(me.data)) return <div className="wrap"><div className="notice">This page is for admins.</div></div>;
  return <>{children}</>;
}
