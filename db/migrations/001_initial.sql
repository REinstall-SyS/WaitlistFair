CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 timezone text NOT NULL DEFAULT 'America/Chicago', offer_seconds integer NOT NULL DEFAULT 900 CHECK(offer_seconds BETWEEN 60 AND 86400),
 demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email = lower(email)),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100), timezone text NOT NULL DEFAULT 'America/Chicago',
 notifications boolean NOT NULL DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE memberships (
 organization_id uuid REFERENCES organizations ON DELETE CASCADE, user_id uuid REFERENCES users,
 role text NOT NULL CHECK(role IN ('admin','tutor','student')), enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 15 AND 240),
 UNIQUE(id,organization_id), UNIQUE(organization_id,name)
);
CREATE TABLE tutors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations,
 user_id uuid NOT NULL REFERENCES users, UNIQUE(id,organization_id), UNIQUE(organization_id,user_id)
);
CREATE TABLE tutor_services (
 tutor_id uuid NOT NULL, service_id uuid NOT NULL, organization_id uuid NOT NULL,
 PRIMARY KEY(tutor_id,service_id), UNIQUE(tutor_id,service_id,organization_id),
 FOREIGN KEY(tutor_id,organization_id) REFERENCES tutors(id,organization_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id)
);
CREATE TABLE slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations,
 tutor_id uuid NOT NULL, service_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'available' CHECK(state IN ('available','offer_pending','booked','closed')),
 canceled_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(ends_at > starts_at),
 UNIQUE(id,organization_id), UNIQUE(id,organization_id,starts_at,ends_at),
 FOREIGN KEY(tutor_id,service_id,organization_id) REFERENCES tutor_services(tutor_id,service_id,organization_id),
 EXCLUDE USING gist(tutor_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(state <> 'closed')
);
CREATE INDEX slots_calendar ON slots(organization_id,starts_at);
CREATE TABLE waitlist_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, student_id uuid NOT NULL,
 service_id uuid NOT NULL, preferences jsonb NOT NULL CHECK(jsonb_typeof(preferences)='object'),
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','satisfied','withdrawn')),
 FOREIGN KEY(organization_id,student_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(service_id,organization_id) REFERENCES services(id,organization_id),
 UNIQUE(id,organization_id,student_id), UNIQUE(id,organization_id)
);
CREATE UNIQUE INDEX one_active_waitlist ON waitlist_entries(organization_id,student_id,service_id) WHERE(status IN ('active','paused'));
CREATE INDEX fifo_waitlist ON waitlist_entries(organization_id,service_id,joined_at,id) WHERE(status='active');
-- Claims cover BOTH pending offers and confirmed bookings. The exclusion is global per student.
CREATE TABLE claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid NOT NULL, organization_id uuid NOT NULL,
 student_id uuid NOT NULL REFERENCES users, entry_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','confirmed','released')),
 FOREIGN KEY(slot_id,organization_id,starts_at,ends_at) REFERENCES slots(id,organization_id,starts_at,ends_at),
 FOREIGN KEY(organization_id,student_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(entry_id,organization_id,student_id) REFERENCES waitlist_entries(id,organization_id,student_id),
 UNIQUE(id,slot_id,organization_id,student_id), CHECK(ends_at>starts_at),
 EXCLUDE USING gist(student_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(state IN ('pending','confirmed'))
);
CREATE UNIQUE INDEX one_live_claim_per_slot ON claims(slot_id) WHERE(state IN ('pending','confirmed'));
CREATE UNIQUE INDEX one_offer_per_entry ON claims(entry_id) WHERE(state='pending');
CREATE TABLE bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid NOT NULL, organization_id uuid NOT NULL,
 student_id uuid NOT NULL, claim_id uuid NOT NULL UNIQUE, state text NOT NULL DEFAULT 'confirmed' CHECK(state IN ('confirmed','canceled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), canceled_at timestamptz,
 FOREIGN KEY(claim_id,slot_id,organization_id,student_id) REFERENCES claims(id,slot_id,organization_id,student_id)
);
CREATE UNIQUE INDEX one_confirmed_booking ON bookings(slot_id) WHERE(state='confirmed');
CREATE TABLE decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, slot_id uuid NOT NULL,
 policy_version text NOT NULL, selected_entry_id uuid, explanation jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(slot_id,organization_id) REFERENCES slots(id,organization_id),
 FOREIGN KEY(selected_entry_id,organization_id) REFERENCES waitlist_entries(id,organization_id)
);
CREATE TABLE offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, slot_id uuid NOT NULL,
 entry_id uuid NOT NULL, recipient_id uuid NOT NULL, claim_id uuid NOT NULL UNIQUE, decision_id uuid NOT NULL REFERENCES decisions,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','expired','revoked')),
 resolved_at timestamptz, CHECK(expires_at>created_at), UNIQUE(slot_id,recipient_id),
 FOREIGN KEY(entry_id,organization_id,recipient_id) REFERENCES waitlist_entries(id,organization_id,student_id),
 FOREIGN KEY(claim_id,slot_id,organization_id,recipient_id) REFERENCES claims(id,slot_id,organization_id,student_id)
);
CREATE UNIQUE INDEX one_pending_offer ON offers(slot_id) WHERE(state='pending');
CREATE INDEX expired_offers ON offers(expires_at) WHERE(state='pending');
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid REFERENCES organizations,
 actor_id uuid REFERENCES users, action text NOT NULL, target_id uuid, metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_org ON audit_events(organization_id,created_at DESC);
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','processing','sent','dead')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz, lease_token uuid, last_error text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), delivered_at timestamptz
);
CREATE INDEX outbox_poll ON outbox(next_attempt_at) WHERE(state IN ('ready','processing'));
CREATE TABLE magic_tokens (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, expires_at timestamptz NOT NULL);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, csrf_token text NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL);
CREATE TABLE idempotency_keys (
 user_id uuid NOT NULL REFERENCES users, key text NOT NULL CHECK(length(key) BETWEEN 8 AND 100),
 operation text NOT NULL, result_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,key)
);
