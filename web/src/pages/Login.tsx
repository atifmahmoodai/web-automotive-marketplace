import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useLogin, useMe, useMeta, useRegister } from "../api/auth";
import { ApiError, errorText } from "../api/client";
import { useTitle } from "../components/ui";

/** Only same-site paths are allowed as the return address (no open redirects). */
export const safeNext = (s: string | null) => (s && s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") && !s.startsWith("/login") && !s.startsWith("/register") ? s : "/");

export function Login() {
  return <AuthForm mode="login" />;
}
export function Register() {
  return <AuthForm mode="register" />;
}

function AuthForm({ mode }: { mode: "login" | "register" }) {
  const me = useMe();
  const site = useMeta().data?.settings.siteName ?? "";
  const login = useLogin();
  const register = useRegister();
  const m = mode === "login" ? login : register;
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const next = safeNext(params.get("next"));
  useTitle(mode === "login" ? "Sign in" : "Join", site);
  if (me.data) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate(mode === "login" ? { email: email.trim(), password } : { name: name.trim(), email: email.trim(), password });
  };
  const errs = m.error instanceof ApiError ? m.error.details : {};
  const other = `${mode === "login" ? "/register" : "/login"}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="login-page">
      <form className="card stack login-card" onSubmit={submit}>
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>{site}</span>
        </Link>
        <h1>{mode === "login" ? "Sign in" : "Create your free account"}</h1>
        {mode === "register" && (
          <label>
            Your name
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoFocus />
            {errs.name && <div className="field-error">{errs.name}</div>}
          </label>
        )}
        <label>
          Email
          <input type="email" autoComplete={mode === "login" ? "username" : "email"} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === "login"} />
          {errs.email && <div className="field-error">{errs.email}</div>}
        </label>
        <label>
          Password
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
          {mode === "register" && <span className="muted small">At least 10 characters with letters and a number.</span>}
          {errs.password && <div className="field-error">{errs.password}</div>}
        </label>
        {m.isError && !Object.keys(errs).length && (
          <div className="field-error" role="alert">
            {errorText(m.error)}
          </div>
        )}
        {m.isError && errs.email === "Already registered" && <Link to={other}>Sign in instead</Link>}
        <button className="btn btn-primary" type="submit" disabled={m.isPending}>
          {m.isPending ? "Please wait…" : mode === "login" ? "Sign in" : "Join"}
        </button>
        <p className="small muted">
          {mode === "login" ? (
            <>
              New here? <Link to={other}>Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to={other}>Sign in</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
