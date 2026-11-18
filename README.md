# WaitlistFair
Fill canceled appointments automatically, fairly, and without double-booking.

A student cancels tomorrow’s calculus session. Three other students are waiting, but the first cannot attend that time. WaitlistFair evaluates their availability, offers the opening to the earliest eligible student, and gives them a fixed deadline to accept. Staff can see exactly why that student was selected.

WaitlistFair is a working tutoring-center application built around this cancellation-to-booking journey. It serves students, tutors, and center administrators. PostgreSQL coordinates the allocation engine; Go serves the API and background worker; Next.js provides the interface. No paid services or university credentials are required for the local demo.

## Run the local demonstration

Requirements: Docker with Compose v2, approximately 3 GB free disk space, and ports 3000, 5432, 8080, 8025, and 1025 available. The supplied Compose file is **for local development** and binds published ports to loopback.

```sh
git clone https://github.com/REinstall-SyS/WaitlistFair.git
cd WaitlistFair
cp .env.example .env
docker compose up --build -d --wait
```

On PowerShell, use `Copy-Item .env.example .env`. Seeding is automatic and idempotent when `SEED_DEMO=true`. The initial build downloads dependencies and can take several minutes.

Open [WaitlistFair](http://localhost:3000) and [Mailpit](http://localhost:8025). There are no demo passwords or impersonation endpoints. Enter one of these fictional email addresses on the sign-in screen, open its captured email in Mailpit, and click **Continue to WaitlistFair**.

| Account | Role | Purpose |
| --- | --- | --- |
| `admin@demo.waitlistfair.test` | Administrator · Alex | Calendar, settings, allocation explanations |
| `maya@demo.waitlistfair.test` | Student · Maya | First eligible calculus waitlist entry |
| `leo@demo.waitlistfair.test` | Student · Leo | Next eligible entry after Maya |
| `nora@demo.waitlistfair.test` | Student · Nora | Earlier entry with incompatible availability |
| `sam@demo.waitlistfair.test` | Student · Sam | Existing booked appointments |
| `emma@demo.waitlistfair.test` | Tutor · Emma | Own calculus schedule |

The seed creates three subjects, three tutors, six future appointments, and three calculus waitlist entries. All demo data is explicitly labeled. Times are anchored to the day after seeding in America/Chicago; an old persistent demo database does not automatically advance its appointments.

### Reproduce the defining workflow

1. Sign in as Alex. Open **Calendar** and cancel the booked **Calculus I** appointment. Confirm the cancellation.
2. Open Mailpit. Maya receives an offer; Nora’s earlier entry is excluded because its availability does not match.
3. In a separate browser profile or private window, sign in as Maya using her captured magic link.
4. Open **My offers**, review the deadline and explanation, and accept. **My appointments** shows the confirmed session.
5. Return to Alex’s **Allocation history**. Inspect the real decision: three considered, one excluded, two eligible, first eligible selected. The **Audit trail** records creation and acceptance.

To demonstrate expiration, cancel a booking to generate a pending offer, then run:

```sh
docker compose exec api /app/manage expire-demo
```

This development-only command moves pending **demo** deadlines to database time. The worker advances the queue within its next polling cycle. Expired offers return HTTP 409 on acceptance. The command is disabled in production. Ordinary production expiration uses fixed deadlines with a configurable 1-minute–24-hour window.

```sh
docker compose down           # stop; retain data
docker compose exec api /app/manage migrate
docker compose exec api /app/manage seed
```

For a fresh demo, use a new Compose project/volume. Removing volumes with `docker compose down -v` permanently deletes that local database.

## Application views

The CI end-to-end suite captures screenshots of the actual running Compose application under `docs/screenshots`. Screenshots are published with the verified demo artifacts and copied into the repository after verification.

![Student workspace](docs/screenshots/student-home.png)
![A real offer](docs/screenshots/student-offer.png)
![Recorded allocation explanation](docs/screenshots/allocation-explanation.png)

## What is implemented

- Email magic links, hashed credentials, seven-day revocable sessions, HttpOnly cookies, origin and CSRF checks, database-backed login throttling.
- Organization creation, membership roles, subject durations, tutor assignments, appointment creation and closure, direct booking and cancellation.
- Student waitlists with recurring local availability, pause/resume/withdraw, real offers, acceptance/decline, appointment history, profiles and notification preferences.
- Appointment entry rejects nonexistent daylight-saving times and asks which occurrence to use when clocks repeat; displayed times include their zone abbreviation.
- FIFO allocation as an interface-independent domain service, with recorded eligibility reasons, stable ID tie-breaking, and versioned decisions.
- Atomic slot transitions, active reservation exclusion constraints, idempotent booking/acceptance, and cross-organization authorization.
- Dedicated worker, fixed offer expiration, transactional outbox, concurrent leases, retries, terminal failures, and SMTP/Mailpit delivery.
- Administrator decision and audit views, real 30-day refill/offer metrics, student privacy boundaries, account anonymization, and credential/event retention cleanup.
- PostgreSQL integration and simultaneous HTTP concurrency tests, frontend logic tests, a real-email Playwright journey, Docker restart recovery tests, and CI.

## How allocation works

The declared policy is **first come, first served among eligible students**, version `fifo-eligible/v1`:

1. Match organization and subject.
2. Require an active entry and an enabled student membership.
3. Fit the entire appointment inside a recurring availability window in the student’s IANA time zone.
4. Exclude conflicting **pending or confirmed** reservations, existing pending offers for the same entry, and anyone previously offered this slot.
5. Order eligible entries by `joined_at`, then stable entry UUID. Do not use hidden scores or ML.

Each decision records requirements, timestamp, considered/eligible/excluded counts, categorized reasons, candidate evidence, selected position, policy version, and resulting offer ID. A candidate can have several exclusion reasons. Students receive a plain-language explanation without other students’ records; detailed evidence is admin-only.

Fairness means adherence to this declared ordering and eligibility policy. It is not a claim of demographic or moral fairness. Read [the concurrency design](docs/concurrency.md) for the precise behavior when eligibility changes during evaluation.

## Architecture

```mermaid
flowchart LR
  Browser[Student / tutor / administrator] --> Web[Next.js · same-origin /api proxy]
  Web --> API[Go HTTP API]
  API --> Domain[Allocation and appointment services]
  Domain --> PG[(PostgreSQL)]
  Worker[Dedicated Go worker] --> PG
  Worker --> SMTP[SMTP / local Mailpit]
  PG --- Records[Slots · claims · bookings · offers · decisions · audit · outbox]
```

`internal/allocation` contains deterministic availability matching and explanation logic. `internal/appointments` owns transactional transitions. `internal/auth`, `internal/notifications`, `internal/persistence`, and `internal/api` separate authentication, delivery, database setup, and HTTP transport. Explicit SQL is kept close to each transaction; pgx scanning provides typed values. sqlc was omitted because most queries are transactional or JSON projections and code generation would add a second source of truth without a clear benefit at this scale.

### Transactions and state machines

All capacity-changing operations first lock the slot row. Claiming a student’s time additionally locks that student row, rechecks eligibility, then relies on PostgreSQL partial unique indexes and a GiST exclusion constraint. Locks are database-visible across API and worker processes. Different slots are not globally serialized. [ADR 001](docs/adr/001-postgres-coordination.md) explains the choice.

```mermaid
stateDiagram-v2
  [*] --> Available
  Available --> OfferPending: select eligible student
  Available --> Booked: direct booking
  OfferPending --> Booked: accept before deadline
  OfferPending --> Available: decline / expire
  Booked --> Available: cancel booking
  Available --> Closed: close
  OfferPending --> Closed: close and revoke
  Booked --> Closed: close and cancel
```

Offers transition only from Pending to Accepted, Declined, Expired, or Revoked. Waitlist entries transition Active → Paused / Satisfied / Withdrawn and Paused → Active / Withdrawn. Closed slots and resolved offers are terminal. Repeated accepted requests can return the original confirmed booking; they never create a new one. [State and transaction details](docs/concurrency.md).

### Reliable notification processing

Business transactions write outbox events before committing. Workers claim independent events with `FOR UPDATE SKIP LOCKED`, a 30-second lease, and a fencing token. SMTP has a 10-second deadline; failures back off exponentially and become terminal after eight attempts. Business state continues to work during an email outage. Restarting the worker recovers expired leases.

SMTP is **at least once**: a crash after SMTP accepts a message but before the outbox acknowledgement can send a duplicate. A stable Message-ID helps recipients/providers identify duplicates but does not guarantee deduplication. Repeated emails cannot create another booking or grant another user permission. [ADR 002](docs/adr/002-transactional-outbox.md).

## Testing

Use Go 1.27.4, Node 24 or newer, and a disposable PostgreSQL 18 database with permission to install `btree_gist` and create test schemas.

```sh
go test ./internal/allocation ./internal/domain
export TEST_DATABASE_URL='postgres://waitlistfair:waitlistfair-local-only@localhost:5432/waitlistfair?sslmode=disable'
go test -race -count=1 -v ./...
go test -race -count=10 -run Test100ConcurrentHTTPClaims -v ./tests/concurrency
cd apps/web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
FAULT_TESTS=1 npm run test:e2e
```

For PowerShell, set `$env:TEST_DATABASE_URL='...'` and `$env:FAULT_TESTS='1'`. The integration suites create isolated randomly named schemas and remove **their own schemas** afterward. They skip explicitly when the database variable is absent; skipped tests are not evidence of database correctness.

The E2E suite expects a **fresh seeded** Compose stack. With `FAULT_TESTS=1`, it stops the notification worker, commits a cancellation, restarts PostgreSQL, restarts the worker, checks persisted delivery, forces a demo expiration, verifies the expired offer is rejected, and accepts the successor offer. It also captures desktop and mobile screenshots.

GitHub Actions runs Go formatting, vet, the race detector, PostgreSQL migrations/integration/concurrency tests, frontend lint/typecheck/unit/build/runtime dependency audit, and the full Compose + Chromium demonstration. No status badge is asserted here. See [verification evidence and methodology](docs/verification.md) for observed results and test conditions.

## API and deployment

See [API reference](docs/api.md), [deployment guide](docs/deployment.md), [security policy](SECURITY.md), and the two [architecture decisions](docs/adr/001-postgres-coordination.md). API errors are JSON `{ "error": "human-readable message" }`; organization IDs and recipient ownership are validated server-side. Decisions and audits support bounded pagination.

## Limits and next steps

This MVP provides one-on-one tutoring and a list-based calendar. It does not implement group capacity, recurring tutor schedule generation, external calendars, calendar export, multi-resource optimization, or alternative allocation policies. Administrators create individual availability and assign permitted subjects to tutors.

The UI reads up to 300 calendar/waitlist records, 200 booking records, and 100 offers per dashboard request; decision/audit history is paginated. This is intended for small centers. Larger deployments need cursor pagination, retention/export tooling, and measured capacity work. Metrics are cohort counts, not causal savings estimates; closed slots are included in cancellation totals but not currently unfilled slots.

Single active pending offer per waitlist entry intentionally limits simultaneous offers. A declined, expired, or revoked offer excludes that student from that slot permanently. Pausing preserves the original join timestamp. Rejoining after withdrawal creates a new timestamp. Eligibility is reevaluated when each candidate is considered under locks; this is not an immutable snapshot of every student at one instant.

Historical bookings/decisions remain for center operations. Account deletion anonymizes identifying fields after active student obligations are resolved; staff must be removed from their role by another administrator. There is no self-service organization deletion or data-export UI. Delivery failures are visible in worker logs and the database; a scoped administrator dead-letter replay UI is future work.

This is not a regulated university records system and has no claimed FERPA/HIPAA certification. Production operation requires HTTPS, authenticated SMTP, managed secrets, backups, monitoring, and an operator-reviewed retention/access policy. See deployment guidance before exposing it publicly.

## License

MIT. Contributions and focused correctness reviews are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
