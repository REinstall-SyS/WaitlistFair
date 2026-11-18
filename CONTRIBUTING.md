# Contributing

Use a focused issue or pull request with a reproducible scenario, the intended behavior, and relevant validation. For scheduling changes, include an explanation of lock ordering, idempotency, and database invariants. Do not replace real PostgreSQL concurrency tests with in-memory mocks.

Run Go formatting/vet/race tests and frontend lint/typecheck/unit/build checks. Use a fresh seeded Compose project for Playwright fault tests. New migrations are forward-only and must preserve existing records. Keep sample data fictional and labeled, do not commit `.env` or credentials, and do not add badges or performance claims without observed evidence.

The primary product is cancellation reallocation for university tutoring. Keep changes centered on safe capacity-one scheduling, understandable student interactions, and explainable policy. See README and ADRs for the current boundaries.
