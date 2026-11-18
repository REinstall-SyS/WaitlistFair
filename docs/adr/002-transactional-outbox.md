# ADR 002: Persist notification intent in the business transaction

Status: accepted.

Sending email inside a transaction either holds locks across an unreliable network request or tells a student about a booking that later rolls back. Sending after commit without durable intent can lose messages if the process exits in between.

Each transaction records its outbox event alongside the state transition and audit history. A dedicated worker claims bounded batches with row locks and SKIP LOCKED, leases each event for 30 seconds, and acknowledges only with its current random lease token. Attempts increment on claim, failures back off by powers of two seconds (capped), and eight failed deliveries produce a terminal dead-letter state. A process that disappears leaves recoverable leases; business reservations are independent of SMTP availability.

Exactly-once external email delivery is not guaranteed. If SMTP accepts a message and the worker dies before acknowledging, a later worker may send it again. A stable Message-ID is included, but SMTP has no universal idempotency guarantee. Offer URLs require an authenticated recipient session; only the database can create a booking, and acceptance is idempotent. Duplicated messages do not duplicate capacity or permissions.

Delivered payloads are cleared. Magic-link payloads are necessarily present while queued for delivery and are purged after 15 minutes. Treat database backups and operational access as sensitive. Terminal non-auth payloads need operator attention and follow the documented retention policy. No notification attempt is a source of booking authority.
