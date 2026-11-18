# Operating WaitlistFair

The checked-in Compose configuration is a local demonstration. GitHub publication publishes source code; it does not create a hosted production service.

## Build and deploy

Build the root Dockerfile for API/worker/manage and `apps/web/Dockerfile` for Next.js. Supply an internal Go API URL at frontend build time (`API_INTERNAL_URL`, currently `http://api:8080` in the Dockerfile) so `/api` rewrites reach the backend. Put the web service behind a TLS reverse proxy. Preserve the public request `Origin` header and do not expose the database, Mailpit, or internal health ports to the Internet.

Set `APP_ENV=production`, `APP_URL=https://your-domain.example`, `SEED_DEMO=false`, `NEXT_PUBLIC_DEMO=false` (frontend build argument), a TLS-verified PostgreSQL `DATABASE_URL`, SMTP address/username/password, and a verified `MAIL_FROM`. Store secrets in your platform’s secret manager. Production SMTP requires STARTTLS with certificate verification. The API rejects production configuration without HTTPS and rejects automatic demo seeding.

The API applies embedded forward SQL migrations at startup, serialized by a database advisory lock. A separate `manage migrate` command supports controlled releases. Back up before migrations and test changes against a restored copy. Migrations are forward-only; recover from a bad schema change with a reviewed corrective migration or a tested restore. The current schema requires `btree_gist`, so arrange extension installation with a DBA if the app role cannot create extensions.

Use a migration role for startup when appropriate, then restrict application privileges to the tables it needs. Containers run as nonroot and use fixed build versions and committed dependency lockfiles. No application secrets are compiled into the frontend.

## Recovery and observability

API and worker emit structured JSON logs. API logs include a request identifier and path, never request bodies, cookies, or magic-link fragments. Health checks test database connectivity. Monitor worker tick errors, overdue pending offers, ready-event age, abandoned leases, and dead events separately; a healthy HTTP probe does not prove processing progress.

After a database outage, pgx pools reconnect on later operations; the worker retries subsequent ticks. Transactions interrupted before commit roll back. Outbox leases abandoned after commit become claimable after 30 seconds. Never manually retry a booking by writing rows around the domain service.

Inspect delivery failures using an operator database connection:

```sql
SELECT id,event_type,state,attempts,next_attempt_at,created_at
FROM outbox WHERE state IN ('ready','processing','dead')
ORDER BY created_at LIMIT 100;
```

After correcting SMTP configuration, an operator can requeue a reviewed, nonstale dead event by ID, setting `state='ready'`, `attempts=0`, `next_attempt_at=clock_timestamp()`, and clearing its lease fields. This may duplicate external email. Reissue an expired magic link through sign-in instead of replaying its event. There is no administrator replay UI yet. Do not print payloads or authentication links in shared logs.

## Retention and privacy

The worker removes expired sessions, magic tokens, and rate-limit buckets hourly. It removes idempotency keys after 30 days, sent outbox events after 30 days, magic-link outbox payloads/events after 15 minutes, and audit events after 180 days. Delivered payloads are cleared immediately. Historical bookings, claims, waitlists, and policy decisions remain for center operations; coordinate exports and additional deletion with an operator-reviewed policy. Dead non-auth notification events currently require manual resolution/deletion.

Eligible student account deletion withdraws active waitlists, disables membership, revokes credentials, and anonymizes name/email. Historical scheduling and availability details remain linked to an anonymous identifier. Staff must first be changed to a student role by another administrator. An admin cannot demote their own role. This is an MVP anonymization mechanism, not a promise of legal erasure compliance.

Configure backup retention and restore testing to match your organization’s requirements. Set a finite retention period for historical scheduling data before onboarding real users. No FERPA/HIPAA compliance assessment is claimed.

## Deliberate limits

There is no Redis, external queue, Kubernetes deployment, or SMTP exactly-once promise. Horizontal API/worker replicas coordinate through PostgreSQL. Do not apply migrations that alter capacity indexes or update claims manually during traffic. Availability and exclusion rules currently assume capacity one, and the interface is sized for a small tutoring center.
