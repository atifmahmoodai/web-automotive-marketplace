import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMe } from "../api/auth";
import { api } from "../api/client";
import { fmtMiles, fmtPrice } from "../lib/format";
import type { ListingCard } from "../../../shared/types";

/** Heart button: saves a car for the signed-in member, or asks a visitor to sign in. */
export function SaveButton({ id, saved, large }: { id: string; saved: boolean; large?: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const toggle = useMutation({
    mutationFn: () => api(`/saved/${id}`, { method: saved ? "DELETE" : "PUT" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["search"] });
      void qc.invalidateQueries({ queryKey: ["car", id] });
      void qc.invalidateQueries({ queryKey: ["saved"] });
    },
  });
  const label = saved ? "Remove from saved cars" : "Save this car";
  return (
    <button
      type="button"
      className={`heart ${saved ? "on" : ""} ${large ? "heart-lg" : ""}`}
      aria-label={label}
      aria-pressed={saved}
      title={label}
      disabled={toggle.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!me.data) nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
        else toggle.mutate();
      }}
    >
      {saved ? "♥" : "♡"}
      {large && <span>{saved ? " Saved" : " Save"}</span>}
    </button>
  );
}

export function CarCard({ car, badge }: { car: ListingCard; badge?: React.ReactNode }) {
  return (
    <article className="car-card">
      <Link to={`/cars/${car.id}`} className="car-link">
        <div className="car-photo">
          {car.photo ? <img src={car.photo.thumb} alt="" loading="lazy" decoding="async" width={480} height={300} /> : <div className="no-photo">No photo</div>}
          {car.photoCount > 1 && <span className="photo-count">📷 {car.photoCount}</span>}
          {badge}
        </div>
        <div className="car-body">
          <h3 className="clip">
            {car.year} {car.make} {car.model}
          </h3>
          <div className="muted small clip">{car.variant || " "}</div>
          <div className="price">
            {fmtPrice(car.priceCents)}
            {car.previousPriceCents !== null && car.previousPriceCents > car.priceCents && <span className="was">was {fmtPrice(car.previousPriceCents)}</span>}
          </div>
          <ul className="specs">
            <li>{fmtMiles(car.mileage)}</li>
            <li>{car.fuel}</li>
            <li>{car.transmission}</li>
          </ul>
          <div className="seller-line small">
            <span className="clip">{car.city}</span>
            <span className="clip">
              {car.sellerKind === "dealer" ? car.sellerName : "Private seller"}
              {car.verified && <span className="tick" title="Verified dealer"> ✔</span>}
            </span>
          </div>
        </div>
      </Link>
      {car.saved !== undefined && <SaveButton id={car.id} saved={car.saved} />}
    </article>
  );
}
