# ADR 001: Coordinate with PostgreSQL rows and constraints

Status: accepted.

API replicas and dedicated workers can act on the same opening. A Go mutex would coordinate only one process and would disappear on restart. We use READ COMMITTED transactions with slot row locks, plus student row locks when adding or promoting a reservation. Every transition rereads the authoritative state after acquiring its locks.

The slot lock is the shared entry point for booking, acceptance, cancellation, decline, expiration, and closure. Partial unique indexes permit at most one confirmed booking, live claim, and pending offer per capacity-one slot. `btree_gist` exclusions prevent overlapping active claims for the same student, including across organizations, and overlapping nonclosed slots for a tutor. A composite foreign key copies slot instants into claims without allowing mismatches.

Allocation waits for earlier candidate user locks; it never uses SKIP LOCKED to jump the queue. Rejected candidate locks are released by rolling back to a savepoint. The selected user's lock remains until commit. This avoids holding a collection of rejected user locks while trying to acquire another, which could cause cycles across slots. There are no global allocation mutexes or organization-wide scheduling locks. An advisory lock is used only to serialize schema migrations and demo initialization.

Tradeoffs: allocation waits behind competing operations involving the same student; large queues cost linear database work; fail-fast statement/lock timeouts can require a caller retry. Uniqueness and exclusion violations become HTTP 409. A rejected candidate can become eligible after its evaluation; the recorded decision documents eligibility when evaluated. See [the full concurrency contract](../concurrency.md).
