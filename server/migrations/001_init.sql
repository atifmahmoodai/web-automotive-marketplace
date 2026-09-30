-- Car marketplace schema. Money is integer cents; times are timestamptz.

CREATE TABLE dealers (
  id         text PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  phone      text NOT NULL DEFAULT '',
  city       text NOT NULL,
  about      text NOT NULL DEFAULT '',
  website    text NOT NULL DEFAULT '',
  -- Checked by a moderator: verified dealers' listings skip the review queue (unless flagged).
  verified   boolean NOT NULL DEFAULT false,
  -- Suspended dealers' listings disappear from the site.
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  dealer_id     text REFERENCES dealers(id),
  dealer_role   text CHECK (dealer_role IN ('owner', 'staff')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((dealer_id IS NULL) = (dealer_role IS NULL))
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_dealer_idx ON users (dealer_id) WHERE dealer_id IS NOT NULL;

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE listings (
  id                  text PRIMARY KEY,
  number              integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id             text NOT NULL REFERENCES users(id),
  -- Set when listed by a dealer: the whole dealer team manages it and it shows under the dealer's name.
  dealer_id           text REFERENCES dealers(id),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'live', 'rejected', 'sold', 'withdrawn', 'removed')),
  make                text NOT NULL,
  model               text NOT NULL,
  variant             text NOT NULL DEFAULT '',
  year                integer NOT NULL,
  mileage             integer NOT NULL CHECK (mileage >= 0),
  fuel                text NOT NULL,
  transmission        text NOT NULL,
  body                text NOT NULL,
  colour              text NOT NULL DEFAULT '',
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  previous_price_cents integer,
  city                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  -- Why the listing was held for review, and the moderator's note when it was rejected or removed.
  flags               jsonb NOT NULL DEFAULT '[]',
  moderation_note     text,
  views               integer NOT NULL DEFAULT 0,
  published_at        timestamptz,
  expires_at          timestamptz,
  sold_at             timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  search              tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', make || ' ' || model || ' ' || variant || ' ' || colour || ' ' || body || ' ' || fuel || ' ' || city)
  ) STORED
);
CREATE INDEX listings_live_idx ON listings (published_at DESC) WHERE status = 'live';
CREATE INDEX listings_live_price_idx ON listings (price_cents) WHERE status = 'live';
CREATE INDEX listings_make_model_idx ON listings (lower(make), lower(model)) WHERE status = 'live';
CREATE INDEX listings_search_idx ON listings USING gin (search);
CREATE INDEX listings_user_idx ON listings (user_id);
CREATE INDEX listings_dealer_idx ON listings (dealer_id) WHERE dealer_id IS NOT NULL;
CREATE INDEX listings_pending_idx ON listings (updated_at) WHERE status = 'pending';

-- Photos live in the database so a backup is complete; see docs/OPERATIONS.md for moving them to object storage.
CREATE TABLE photos (
  id         text PRIMARY KEY,
  listing_id text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  thumb_mime text,
  thumb      bytea,
  size       integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_listing_idx ON photos (listing_id, position);

CREATE TABLE favourites (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX favourites_listing_idx ON favourites (listing_id);

CREATE TABLE saved_searches (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  filters      jsonb NOT NULL,
  -- Matches published after this are "new" for the member.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_user_idx ON saved_searches (user_id);

-- One conversation per buyer and listing. The seller side is the listing's owner or dealer team.
CREATE TABLE threads (
  id              text PRIMARY KEY,
  listing_id      text NOT NULL REFERENCES listings(id),
  buyer_id        text NOT NULL REFERENCES users(id),
  buyer_read_at   timestamptz NOT NULL DEFAULT now(),
  seller_read_at  timestamptz NOT NULL DEFAULT '-infinity',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, buyer_id)
);
CREATE INDEX threads_buyer_idx ON threads (buyer_id, last_message_at DESC);
CREATE INDEX threads_listing_idx ON threads (listing_id);

CREATE TABLE messages (
  id         text PRIMARY KEY,
  thread_id  text NOT NULL REFERENCES threads(id),
  sender_id  text NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON messages (thread_id, created_at);

CREATE TABLE reports (
  id              text PRIMARY KEY,
  listing_id      text NOT NULL REFERENCES listings(id),
  reporter_id     text NOT NULL REFERENCES users(id),
  reason          text NOT NULL,
  note            text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolved_by     text REFERENCES users(id),
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- One open report per person and listing.
CREATE UNIQUE INDEX reports_open_once ON reports (listing_id, reporter_id) WHERE status = 'open';
CREATE INDEX reports_open_idx ON reports (created_at) WHERE status = 'open';

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   text REFERENCES users(id) ON DELETE SET NULL,
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  details   jsonb NOT NULL DEFAULT '{}',
  ip        text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
