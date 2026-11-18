# Concurrency contract

## Capacity and overlap

The database permits at most one `bookings(state='confirmed')` row per slot. The `claims` table reserves time for **both** pending offers and confirmed bookings. Its unique live-slot index and GiST `(student_id =, tstzrange(starts_at, ends_at, '[)') &&)` exclusion prevent capacity reuse and student overlaps even across organizations. Adjacent intervals are allowed. Claims reference exact slot instants via a composite foreign key. Tutor slots have their own overlap exclusion.

Slots are immutable in tutor, subject, and instants after creation. Closing is terminal. Changing time means closing an old slot and creating a new one; there is no partially updated reservation interval.

## Locking protocol

1. Begin READ COMMITTED transaction with bounded database timeouts.
2. Lock the target slot with `SELECT ... FOR UPDATE`.
3. If adding/promoting a claim, lock the student user row.
4. Revalidate authorization, current state, authoritative database deadline, and relevant waitlist conditions. The live claim exclusion revalidates interval conflicts.
5. Write claim/booking/offer/waitlist updates, audit, and outbox in that transaction.
6. Commit; only workers can then send email.

The deadline check is the acceptance decision point after locks are acquired; an acceptance that passes before the deadline may commit shortly afterward. An acceptance evaluated at or after the deadline fails even if a worker has not yet marked the offer expired. Browser countdowns are advisory. Acceptance versus expiration and admin closure serialize on the same slot row.

Same-offer acceptance retries return its existing confirmed booking. After cancellation, a new request with a new idempotency key cannot resurrect that booking. A matching stored key returns the original operation result without changing state. Keys are scoped to authenticated user and operation, retained for 30 days, and never grant ownership of another user's offer.

Cancellation also carries the original booking ID. After the slot lock is acquired, the service checks that exact booking's ownership and state. Retrying a completed cancellation returns success for the old booking even if a replacement student has since accepted the slot. It never interprets a retry as permission to cancel the current replacement booking. Closing an entire slot is a separate staff-only resource operation.

## FIFO evaluation

Entries are read in `(joined_at,id)` order. Availability is calculated independently using their IANA zone and entire slot interval, including timezone-offset transitions. Prior offers, inactive status, disabled participation, conflicting active reservations, and an existing pending entry offer are recorded exclusions.

The engine waits on each earlier matching candidate's user row and entry row, then rereads eligibility. It does not skip locked users. If rejected, rolling back to a per-candidate savepoint releases their locks. Once selected, that student's user/entry locks stay held until commit, and the engine creates the pending claim. Other slots can proceed but will observe that reservation before selecting the same student for overlapping time.

The initial explanation includes all matching-subject entries, including inactive ones. Each candidate record retains its join timestamp, evaluated timestamp, reasons, and availability snapshot so later preference edits cannot rewrite the historical evidence. Later candidates' reasons are observations from the initial evaluation; candidates reached during selection have their preferences and eligibility reread after acquiring their locks. We do **not** claim the entire population was frozen at a single instant. An earlier student whose conflict is removed after their rejection can be eligible for the next allocation. Stable FIFO ordering is strict among the candidates found eligible as the ordered evaluation proceeds.

Waitlist pause/resume keeps `joined_at`; withdrawal is terminal. Changes to preferences/status are refused while an offer is pending, so students respond to the offer before changing its eligibility basis. The selected entry becomes satisfied on acceptance. Different entries for the same student can hold nonoverlapping offers, but each entry has at most one pending offer.

## Failure handling

If the process or database fails before commit, the state transition and outbox both roll back. If it fails after commit, the worker can still discover the outbox event. A repeated expiration, cancellation, allocation, or lease claim cannot create a second confirmed booking. Independent notification claims use SKIP LOCKED, whereas candidate selection does not.

Workers poll at one second, examine at most 50 overdue offers and 20 newly requested allocation slots per tick, and claim at most 20 notification events. Expiration and subsequent allocation share a transaction. Joining/resuming a waitlist requests another evaluation for canceled unfilled slots. There is no guarantee of delivery before a deadline if SMTP is unavailable; offers remain visible in the app.

## State transitions

| Entity | From | Allowed destinations |
| --- | --- | --- |
| Slot | available | offer_pending, booked, closed |
| Slot | offer_pending | available, booked, closed |
| Slot | booked | available, closed |
| Slot | closed | none |
| Offer | pending | accepted, declined, expired, revoked |
| Offer | resolved | none (accept retries return existing result only) |
| Waitlist | active | paused, satisfied, withdrawn |
| Waitlist | paused | active, withdrawn |
| Waitlist | satisfied, withdrawn | none |

The domain's transition table has exhaustive pairwise tests. Transaction methods enforce the same transitions against current database state, with narrow idempotent exceptions. Tests exercise both legal and terminal transitions through real PostgreSQL.
