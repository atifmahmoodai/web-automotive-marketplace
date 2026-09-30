import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMeta } from "../api/auth";
import { api, errorText } from "../api/client";
import { Empty, Loading, Status, useTitle } from "../components/ui";
import { ago, fmtDateTime, fmtPrice } from "../lib/format";
import type { Message, ThreadSummary } from "../../../shared/types";

export function Messages() {
  const { id } = useParams();
  const site = useMeta().data?.settings.siteName ?? "";
  useTitle("Messages", site);
  const threads = useQuery({ queryKey: ["threads"], queryFn: () => api<{ items: ThreadSummary[] }>("/threads"), refetchInterval: 30_000 });

  return (
    <div className="wrap">
      <h1 className={id ? "hide-narrow" : ""}>Messages</h1>
      <div className={`inbox ${id ? "has-thread" : ""}`}>
        <nav className="card conv-list" aria-label="Conversations">
          {threads.isPending && <Loading />}
          {threads.isError && <div className="notice notice-bad">{errorText(threads.error)}</div>}
          {threads.data?.items.length === 0 && <Empty title="No messages yet"><p className="muted small">Find a car you like and message the seller from its page.</p></Empty>}
          {threads.data?.items.map((t) => (
            <Link key={t.id} to={`/messages/${t.id}`} className={`conv ${t.id === id ? "on" : ""} ${t.unread ? "unread" : ""}`} aria-current={t.id === id ? "page" : undefined}>
              {t.photo ? <img src={t.photo.thumb} alt="" width={64} height={40} /> : <span className="no-photo small">—</span>}
              <span className="stack-sm grow">
                <span className="row-tight">
                  <b className="clip">{t.otherName}</b>
                  <span className="muted small">{ago(t.lastAt)}</span>
                </span>
                <span className="small clip">{t.listingTitle}</span>
                <span className="muted small clip">{t.lastBody}</span>
              </span>
              {t.unread > 0 && <span className="count">{t.unread}</span>}
            </Link>
          ))}
        </nav>
        {id ? <Thread id={id} /> : <div className="card muted hide-narrow center">Pick a conversation.</div>}
      </div>
    </div>
  );
}

function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["thread", id],
    queryFn: async () => {
      const r = await api<{ thread: ThreadSummary; messages: Message[] }>(`/threads/${encodeURIComponent(id)}`);
      // Opening a thread marks it read on the server; refresh the badges.
      void qc.invalidateQueries({ queryKey: ["unread"] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
      return r;
    },
    refetchInterval: 15_000,
    retry: false,
  });
  const [body, setBody] = useState("");
  const end = useRef<HTMLLIElement>(null);
  const send = useMutation({
    mutationFn: () => api(`/threads/${encodeURIComponent(id)}/messages`, { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["thread", id] });
    },
  });
  const count = q.data?.messages.length ?? 0;
  // Braces matter: newer browsers return a Promise from scrollIntoView, and React would call it as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="card"><div className="notice notice-bad">{errorText(q.error)}</div></div>;
  const { thread: t, messages } = q.data;
  const closed = t.listingStatus === "removed";
  return (
    <section className="card thread stack" aria-label={`Conversation with ${t.otherName}`}>
      <Link to="/messages" className="show-narrow small">‹ All messages</Link>
      <div className="row">
        {t.photo && <img src={t.photo.thumb} alt="" width={80} height={50} className="thread-photo" />}
        <div className="grow">
          <h2 className="clip">
            <Link to={`/cars/${t.listingId}`}>{t.listingTitle}</Link>
          </h2>
          <div className="muted small">
            {fmtPrice(t.priceCents)} · {t.role === "buyer" ? `Seller: ${t.otherName}` : `Buyer: ${t.otherName}`} {t.listingStatus !== "live" && <Status value={t.listingStatus} />}
          </div>
        </div>
      </div>
      <ul className="messages" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`msg ${m.mine ? "out" : "in"}`}>
            <div className="bubble">{m.body}</div>
            <span className="meta small">
              {m.mine ? "You" : m.senderName} · {fmtDateTime(m.createdAt)}
            </span>
          </li>
        ))}
        <li ref={end} aria-hidden />
      </ul>
      {closed ? (
        <div className="notice">This listing was removed by our moderators, so the conversation is closed.</div>
      ) : (
        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) send.mutate();
          }}
        >
          <label className="grow">
            <span className="sr-only">Your reply</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={body}
              placeholder="Write a reply…"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && body.trim()) send.mutate();
              }}
            />
          </label>
          <button className="btn btn-primary" disabled={send.isPending || !body.trim()}>
            Send
          </button>
        </form>
      )}
      {send.isError && <div className="field-error">{errorText(send.error)}</div>}
    </section>
  );
}
