import { Link } from "react-router-dom";
import { useMeta } from "../api/auth";
import { useTitle } from "../components/ui";

export function Safety() {
  const site = useMeta().data?.settings.siteName ?? "us";
  useTitle("Buying safely", site);
  return (
    <div className="wrap narrow">
      <article className="card stack prose">
        <h1>Buying and selling safely</h1>
        <h2>Buyers</h2>
        <ul>
          <li>See the car in person, in daylight, before you pay anything. Check the V5C / registration document matches the seller and the car.</li>
          <li>Never send a deposit to "hold" a car you haven't seen, and never pay by gift card, crypto or money transfer services.</li>
          <li>Be wary of cars far cheaper than similar ones, sellers who are "abroad", and cars "with a shipping agent".</li>
          <li>Run a history check (outstanding finance, write-off, stolen) before you buy.</li>
          <li>Keep conversations in {site} messages. If a seller pushes you to email or WhatsApp straight away, be careful.</li>
        </ul>
        <h2>Sellers</h2>
        <ul>
          <li>Buyers message you here, so you don't need to put your phone number or email in the advert.</li>
          <li>Don't hand over keys or documents until the money has cleared in your account. Be wary of "overpayment" and "my agent will collect" stories.</li>
          <li>Accompany test drives and check the driver's licence and insurance.</li>
        </ul>
        <h2>Something wrong?</h2>
        <p>
          Use <b>Report this listing</b> on any car page. Our moderators review reports, and listings reported by several people are taken down until they've been checked.
        </p>
        <Link to="/" className="btn btn-primary">Back to the cars</Link>
      </article>
    </div>
  );
}
