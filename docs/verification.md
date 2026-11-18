# Verification and benchmark methodology

This file records only observed results. Before a verified CI run, the existence of tests is not a claim that they passed.

## Reproduce

`go test -race -count=1 -v ./...` requires `TEST_DATABASE_URL` and a real PostgreSQL database. Every fixture creates a dedicated randomly named schema. The backend workflow installs Go 1.27.4 and runs PostgreSQL 18 as a service. Its artifacts contain complete test logs, Go-formatted source/module checks, and `uname`, `lscpu`, and memory information from the runner.

`Test100ConcurrentHTTPClaims` starts 100 goroutines behind a shared barrier. Each sends an actual HTTP POST with a different authenticated student session to one slot. It checks exactly one successful response, 99 conflicts, zero unexpected responses, and exactly one confirmed booking in PostgreSQL. Pool size is 24 connections. This measures a contention test’s total wall time; it is not steady-state throughput or a production SLA.

`TestDuplicateOfferAcceptance` sends 100 simultaneous HTTP requests against one real pending offer, using the same idempotency key, and requires one booking. Other tests cover lock-coordinated duplicate allocation/cancellation, overlap exclusion, independent slots, FIFO evidence, terminal offer states, session/token replay, CSRF, and cross-organization ownership.

The acceptance/expiration test repeats a concurrent race twelve times around a short database deadline. If expiration wins, that offer must produce no booking; if acceptance wins, at most one booking exists. The test does not impose a predetermined winner on a race.

The outbox crash test simulates SMTP acceptance without acknowledgement, expires the persisted lease, redelivers, and verifies one business offer plus two external send attempts. It proves recovery behavior and the limits of exactly-once SMTP delivery. SMTP itself is exercised by the separate real Mailpit end-to-end test.

The Compose workflow builds and starts PostgreSQL, API, worker, Next.js, and Mailpit; Playwright then signs in through real email, joins a waitlist, cancels a booking, accepts an offer, checks audit evidence, and captures actual UI screenshots. Fault mode restarts the database while committed work awaits a stopped notification worker, then verifies recovery and expiration advancement. It tests restart persistence, not every possible mid-commit network partition.

## Local environment

The authoring Windows host has Node 26.13.0 and GitHub CLI. It has no Docker, Go, or PostgreSQL installation on PATH. An official checksum-verified portable Go download was blocked by Windows Application Control; WSL is not installed. Backend/Compose verification therefore uses the recorded Linux GitHub Actions environment. Local frontend type checking and the three Vitest logic tests passed during implementation. The Windows build compiled and passed TypeScript but its standalone output encountered an OS directory permission failure; the Linux build is the deployment verification target.

## Observed CI results

Pending the first complete CI run. No load latency or throughput measurement is claimed until logs are recorded here.
