import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Layout, RequireUser } from "./components/Layout";
import { Loading } from "./components/ui";
import { Search } from "./pages/Search";

const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const CarPage = page(() => import("./pages/CarPage"), "CarPage");
const DealerPage = page(() => import("./pages/DealerPage"), "DealerPage");
const Login = page(() => import("./pages/Login"), "Login");
const Register = page(() => import("./pages/Login"), "Register");
const Saved = page(() => import("./pages/Saved"), "Saved");
const Messages = page(() => import("./pages/Messages"), "Messages");
const MyListings = page(() => import("./pages/MyListings"), "MyListings");
const EditListing = page(() => import("./pages/EditListing"), "EditListing");
const DealerAccount = page(() => import("./pages/DealerAccount"), "DealerAccount");
const Account = page(() => import("./pages/Account"), "Account");
const Moderation = page(() => import("./pages/Moderation"), "Moderation");
const Admin = page(() => import("./pages/Admin"), "Admin");
const AuditLog = page(() => import("./pages/AuditLog"), "AuditLog");
const Safety = page(() => import("./pages/Safety"), "Safety");

const signedIn = (el: React.ReactNode, role?: "staff" | "admin") => <RequireUser role={role}>{el}</RequireUser>;

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route element={<Layout />}>
            <Route index element={<Search />} />
            <Route path="cars/:id" element={<CarPage />} />
            <Route path="dealers/:slug" element={<DealerPage />} />
            <Route path="safety" element={<Safety />} />
            <Route path="saved" element={signedIn(<Saved />)} />
            <Route path="messages" element={signedIn(<Messages />)} />
            <Route path="messages/:id" element={signedIn(<Messages />)} />
            <Route path="sell" element={signedIn(<MyListings />)} />
            <Route path="sell/:id" element={signedIn(<EditListing />)} />
            <Route path="dealer" element={signedIn(<DealerAccount />)} />
            <Route path="account" element={signedIn(<Account />)} />
            <Route path="moderation" element={signedIn(<Moderation />, "staff")} />
            <Route path="moderation/:tab" element={signedIn(<Moderation />, "staff")} />
            <Route path="admin" element={signedIn(<Admin />, "admin")} />
            <Route path="admin/activity" element={signedIn(<AuditLog />, "admin")} />
            <Route
              path="*"
              element={
                <div className="wrap narrow">
                  <div className="card stack">
                    <h1>Page not found</h1>
                    <Link to="/" className="btn btn-primary">Browse cars</Link>
                  </div>
                </div>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
