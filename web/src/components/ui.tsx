import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { STATUS_LABEL } from "../lib/format";

const TONES: Record<string, string> = {
  live: "badge-good",
  pending: "badge-brand",
  draft: "",
  rejected: "badge-warn",
  sold: "badge-dark",
  withdrawn: "",
  removed: "badge-bad",
  expired: "badge-warn",
};
export function Status({ value }: { value: string }) {
  return <span className={`badge ${TONES[value] ?? ""}`}>{STATUS_LABEL[value] ?? value}</span>;
}

/** Accessible dialog: focus moves in, Escape closes, focus returns to the opener afterwards. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, textarea, select, button:not(.close)")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={box} className="card modal stack" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{title}</h2>
          <span className="spacer" />
          <button type="button" className="btn btn-sm close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = Array.from(new Set([1, page - 1, page, page + 1, pages])).filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 && <Link to={href(page - 1)} rel="prev">‹ Previous</Link>}
      {nums.map((p, i) => (
        <span key={p}>
          {i > 0 && p - nums[i - 1] > 1 && <span className="muted">…</span>}
          {p === page ? <b aria-current="page">{p}</b> : <Link to={href(p)}>{p}</Link>}
        </span>
      ))}
      {page < pages && <Link to={href(page + 1)} rel="next">Next ›</Link>}
    </nav>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Sets the browser tab title for the page. */
export function useTitle(title: string | undefined, site = "") {
  useEffect(() => {
    if (title !== undefined) document.title = site ? `${title} · ${site}` : title;
  }, [title, site]);
}

export function Loading() {
  return <div className="wrap muted" aria-busy="true">Loading…</div>;
}
