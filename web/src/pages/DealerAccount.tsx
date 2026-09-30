import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMe, useMeta } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { Loading, useTitle } from "../components/ui";
import type { Dealer } from "../../../shared/types";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  dealerRole: "owner" | "staff";
}

export function DealerAccount() {
  const me = useMe().data!;
  const qc = useQueryClient();
  useTitle("Dealer account", useMeta().data?.settings.siteName ?? "");
  const q = useQuery({ queryKey: ["dealer"], queryFn: () => api<{ dealer: Dealer | null; team: TeamMember[] }>("/dealer") });
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["dealer"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
    void qc.invalidateQueries({ queryKey: ["my-listings"] });
  };
  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="wrap narrow"><div className="notice notice-bad">{errorText(q.error)}</div></div>;
  const { dealer, team } = q.data;
  return (
    <div className="wrap narrow">
      <h1>Dealer account</h1>
      {!dealer ? (
        <>
          <p className="muted">
            A dealer account lists cars under your business name, with your phone number and a page of all your stock. Your team can share it. Our moderators verify dealers; verified dealers' cars go live straight away.
          </p>
          <DealerForm dealer={null} onSaved={reload} />
        </>
      ) : (
        <>
          <div className="notice">
            {dealer.verified ? "✔ Verified: your listings go live straight away (unless something in them needs a check)." : "Not verified yet: a moderator checks your listings before they go live. Verification usually follows your first few listings."}{" "}
            <Link to={`/dealers/${dealer.slug}`}>Your public page ›</Link>
          </div>
          {me.dealerRole === "owner" ? <DealerForm dealer={dealer} onSaved={reload} /> : <p>You're on the {dealer.name} team. Only the owner can change the dealer details.</p>}
          <Team team={team} owner={me.dealerRole === "owner"} meId={me.id} onChange={reload} />
        </>
      )}
    </div>
  );
}

function DealerForm({ dealer, onSaved }: { dealer: Dealer | null; onSaved: () => void }) {
  const [f, setF] = useState({ name: dealer?.name ?? "", phone: dealer?.phone ?? "", city: dealer?.city ?? "", about: dealer?.about ?? "", website: dealer?.website ?? "" });
  const save = useMutation({ mutationFn: () => api("/dealer", { method: dealer ? "PUT" : "POST", body: f }), onSuccess: onSaved });
  const errs = save.error instanceof ApiError ? save.error.details : {};
  const input = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      {label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
      {errs[k] && <span className="field-error">{errs[k]}</span>}
    </label>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{dealer ? "Details" : "Open a dealer account"}</h2>
      <div className="form-grid">
        {input("name", "Business name", { required: true, maxLength: 100 })}
        {input("city", "Town or city", { required: true, maxLength: 60 })}
        {input("phone", "Phone for buyers (optional)", { type: "tel", maxLength: 40 })}
        {input("website", "Website (optional)", { type: "url", maxLength: 300, placeholder: "https://" })}
      </div>
      <label>
        About the business
        <textarea rows={4} maxLength={2000} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} />
      </label>
      {save.isError && !Object.keys(errs).length && <div className="notice notice-bad">{errorText(save.error)}</div>}
      {save.isSuccess && dealer && <div className="notice notice-good">Saved.</div>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={save.isPending}>{dealer ? "Save" : "Open dealer account"}</button>
      </div>
    </form>
  );
}

function Team({ team, owner, meId, onChange }: { team: TeamMember[]; owner: boolean; meId: string; onChange: () => void }) {
  const [email, setEmail] = useState("");
  const add = useMutation({
    mutationFn: () => api("/dealer/staff", { method: "POST", body: { email } }),
    onSuccess: () => {
      setEmail("");
      onChange();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/dealer/staff/${id}`, { method: "DELETE" }), onSuccess: onChange });
  const leave = useMutation({ mutationFn: () => api("/dealer/leave", { method: "POST" }), onSuccess: onChange });
  return (
    <section className="card stack">
      <h2>Team</h2>
      <ul className="plain team">
        {team.map((t) => (
          <li key={t.id} className="row">
            <span className="grow">
              <b>{t.name}</b> <span className="muted small">{t.email}</span>
            </span>
            <span className="badge">{t.dealerRole}</span>
            {owner && t.dealerRole === "staff" && (
              <button className="btn btn-sm" disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>
                Remove
              </button>
            )}
            {!owner && t.id === meId && (
              <button className="btn btn-sm" disabled={leave.isPending} onClick={() => leave.mutate()}>
                Leave team
              </button>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label className="grow">
            Add a team member by email (they need an account first)
            <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn" disabled={add.isPending}>Add</button>
        </form>
      )}
      {(add.isError || remove.isError || leave.isError) && <div className="field-error">{errorText(add.error ?? remove.error ?? leave.error)}</div>}
    </section>
  );
}
