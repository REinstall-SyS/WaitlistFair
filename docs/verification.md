# Verification and benchmark methodology

The application source `7c7d2ce08f0ebf09135fc908f40e081e00603328` is verified by [GitHub Actions run 44349395373](https://github.com/REinstall-SyS/WaitlistFair/actions/runs/44349395373), on November 18, 2026. All three jobs passed, including the complete Docker Compose and Chromium workflow. The final documentation-only commit records logs and screenshots without changing the verified application code.

## Observed results

| Check | Observed result |
| --- | --- |
| Go formatting, module consistency, vet | Passed |
| Go unit + real PostgreSQL integration/concurrency tests, race detector enabled | Passed |
| 100 simultaneous HTTP claims, repeated ten times | 1,000 requests; 10 confirmed bookings, 990 conflicts; no unexpected responses |
| Same-offer acceptance, 100 simultaneous identical-key requests | One confirmed booking; all 100 requests succeeded |
| Locked availability edit | Allocator reread changed preferences and selected the next eligible student |
| Cancellation retry after replacement acceptance | Original cancellation remained idempotent; replacement stayed confirmed |
| Frontend lint, TypeScript, Vitest, production build | Passed; eight Vitest tests |
| Runtime npm dependency audit | Zero reported vulnerabilities |
| Full Docker Compose / Chromium journey | Passed: real email, booking, expiration, audit, database restart and worker recovery |

Complete [backend test output](evidence/backend-tests.txt), [stress output](evidence/stress-tests.txt), and [runner conditions](evidence/runner.txt) are committed. No skipped integration tests are counted as evidence. The workflow explicitly sets TEST_DATABASE_URL and uses a real PostgreSQL 18 service.

## Measured contention workload

The final ten capacity-contention runs took **458.6-548.7 ms**, with **472.2 ms median** total HTTP workload wall time. These are observed contention-test timings with Go's race detector, not per-request latency, steady-state throughput, or a production SLA.

Each repetition used one fresh capacity-one slot, 100 distinct authenticated students, 100 goroutines released from a shared barrier, an actual local HTTP server, and a 24-connection pgx pool. The timed interval excludes fixture/schema creation and seeding. The compiled process and database caches were warm across repetitions. Both API and PostgreSQL ran on the CI host, without an external network hop.

Runner: Linux x86-64 GitHub-hosted VM, four visible vCPUs, AMD EPYC 7763, 15 GiB RAM, Go 1.27.4, PostgreSQL 18. This is shared cloud infrastructure. Results vary with runner hardware and load; no performance claim is extrapolated beyond this workload.

Reproduce with a disposable database:

```sh
export TEST_DATABASE_URL='postgres://user:password@localhost:5432/waitlistfair_test?sslmode=disable'
go test -race -count=1 -v ./...
go test -race -count=10 -run Test100ConcurrentHTTPClaims -v ./tests/concurrency
```

PowerShell: set `$env:TEST_DATABASE_URL='...'` and run the same Go commands, or `scripts/stress.ps1`. Every fixture creates a randomly named test schema and removes its own schema afterward. Tests explicitly skip when the database variable is missing; a skip is not a database correctness result.

## What the tests establish

Capacity tests check one winner, 99 conflicts, zero unexpected responses, and exactly one confirmed booking. Duplicate acceptance uses 100 real simultaneous HTTP requests against one offer. Other tests cover overlapping pending/confirmed reservations, independent allocations, FIFO ties and exclusion evidence, terminal offer states, recipient/organization authorization, magic-token replay, session revocation, and CSRF.

The acceptance/expiration test repeats a race twelve times around a short database deadline. It permits either valid winner while rejecting a booking from an expired offer. A lock-wait regression holds an earlier student's row lock, waits until the allocator is blocked, changes availability, and releases the lock. The engine must reread it, select the next eligible student, and retain the evaluated snapshot despite later edits.

A cancellation regression cancels the original booking, accepts its replacement, and retries the original cancellation through both the domain service and HTTP API. The replacement must remain confirmed.

The notification crash test simulates SMTP acceptance without acknowledgement, expires the persisted lease, and redelivers. It checks one business offer and two external send attempts, demonstrating the limits of exactly-once SMTP delivery. Real SMTP delivery is tested separately with Mailpit in the complete browser journey.

Availability tests include spring gaps, both repeated fall-hour occurrences, intervals crossing an offset transition, second-precision boundaries, and whole-appointment matching. Frontend tests also reject nonexistent local date entry, return both repeated-time choices, handle quarter-hour offsets, and reject calendar normalization. Displayed times retain offset-distinguishing zone abbreviations.

## Complete application demonstration

The Compose job builds PostgreSQL, Go API, worker, Next.js, and Mailpit. Chromium signs in using real captured magic-link emails, joins a waitlist, cancels a booking, receives and accepts an offer, views the confirmed appointment and recorded explanation, and checks the audit event. It also creates availability through the admin interface and checks mobile navigation focus/Escape behavior and layout width.

Fault mode stops the notification worker, commits a cancellation, restarts PostgreSQL, restarts the worker, verifies durable delivery, forces a demonstration offer deadline, rejects the expired offer, and accepts the next recipient's offer. It tests restart persistence rather than every possible mid-commit partition. Screenshots under `docs/screenshots` come from the actual passing Compose application.

## Authoring environment and limits

The Windows authoring host has Node 26.13.0 and GitHub CLI, but no Docker, Go, or PostgreSQL installed on PATH; WSL is absent. An official checksum-verified Go download was blocked by Windows Application Control. Backend and Compose verification therefore used Linux CI. Local frontend lint, type checking, eight logic tests, and the standalone production build passed. Temporary portable tooling was removed after use.

The full development dependency audit reports an unpatched development-tool glob ReDoS advisory; the runtime-only audit is clean. See SECURITY.md. These results do not constitute an independent security assessment or regulatory certification.
