# Security policy

Report a vulnerability privately through GitHub’s private vulnerability reporting when available. Do not put real student records, session cookies, sign-in tokens, or secrets in a public issue. This project is an MVP and has not undergone an independent security assessment.

The server enforces organization membership and recipient ownership, single-use hashed magic tokens, expiring/revocable sessions, origin checks, synchronizer CSRF tokens for authenticated writes, strict request DTOs, bounded bodies/queries, and database-backed sign-in throttling. SQL parameters are bound with pgx. Students do not receive other students’ waitlist or offer records. Demo identity is never selected by a URL parameter.

Only authentication metadata and contact/scheduling details are collected; there are no payments or academic records. Queued email payloads and backups can contain private data. Operators must configure access, TLS, backups, deletion, and retention before onboarding real users. Do not advertise regulatory compliance based on this implementation.

The frontend CSP blocks framing and external resources but currently allows inline scripts/styles for Next.js hydration. A nonce-based strict CSP, organization-level export/deletion workflows, comprehensive audit review, and additional abuse prevention are follow-up work.

During implementation, `npm audit --omit=dev --audit-level=high` reported no runtime dependency vulnerabilities. The full development-tool dependency tree reported a high-severity unpatched picomatch glob-pattern ReDoS advisory (GHSA-fc5q-39xc-vjpf). These tools consume repository/developer patterns rather than public user patterns; do not run them on untrusted pattern input. This is documented rather than suppressed or worked around with an incompatible downgrade. Recheck the audit database when upgrading.
