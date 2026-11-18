# HTTP API

Next.js proxies `/api/*` to the Go API on the same origin. Browser sessions use a `wf_session` HttpOnly, SameSite=Lax cookie (Secure in production). All writes require `Origin: APP_URL`. Authenticated writes additionally require the `X-CSRF-Token` returned by `GET /api/me`. JSON bodies require `Content-Type: application/json`; unknown fields and extra JSON objects are rejected. Request bodies are capped at 64 KiB. URLs use UUID identifiers.

Organization-scoped paths below start with `/api/orgs/{org}`. The server verifies enabled membership on each operation, and student actions verify record ownership. IDs alone are never bearer credentials. Responses and sign-in tokens must not be cached. Responses contain `X-Request-ID` for log correlation; sign-in URLs put tokens in the fragment to avoid HTTP access-log leakage.

## Authentication and accounts

| Method / path | Request | Result |
| --- | --- | --- |
| POST `/api/auth/request` | `{ "email": "student@example.edu" }` | 202 generic response; email/IP throttled |
| POST `/api/auth/verify` | `{ "token": "64-hex-character-token" }` | 200; consumes valid token and sets session cookie |
| POST `/api/auth/logout` | none | 200; revoke current session |
| GET `/api/me` | none | `{ user: { id,email,display_name,timezone,notifications,csrf }, organizations: [...] }` |
| PATCH `/api/account` | `{ "display_name":"Maya", "timezone":"America/Chicago", "notifications":true }` | 200 |
| DELETE `/api/account` | none | 200; anonymize eligible student, revoke sessions; 400 if active obligations/staff role remain |
| POST `/api/organizations` | `{ "name":"Tutoring center", "timezone":"America/Chicago" }` | 201 `{id}`; creator becomes admin |

Magic links are single-use, expire after 15 minutes, and store only token hashes in the credential table. Email payloads contain the link while queued. Sessions expire after seven days. Requesting a link creates an account when necessary; an unaffiliated user may create an organization or ask an admin to add their email.

## Organization operations

| Method / suffix | Permission | Request / result |
| --- | --- | --- |
| GET `/dashboard` | member | `{server_time,services,tutors,slots,bookings,offers,waitlist,members?}`; role-specific projections |
| POST `/slots` | admin, assigned tutor | `{tutor_id,service_id,starts_at}`; RFC3339 instant with offset; end derives from subject duration; 201 `{id}` |
| POST `/slots/{id}/book` | student | no body; `Idempotency-Key` required; 201 `{id}` |
| POST `/slots/{id}/cancel` | admin, assigned tutor, booked owner | no body; 200; cancels booking and allocates replacement atomically |
| POST `/slots/{id}/close` | admin, assigned tutor | no body; 200; closes slot, cancels booking/revokes pending offer |
| POST `/waitlist` | student | `{service_id,preferences:{timezone,windows:[{day:1,start:"09:00",end:"17:00"}]}}`; 201 `{id}` |
| PATCH `/waitlist/{id}` | entry owner | `{status:"active"|"paused"|"withdrawn",preferences?:...}`; pending offer must be resolved first |
| POST `/offers/{id}/accept` | recipient student | no body; `Idempotency-Key` required; 200 `{id:bookingId}` |
| POST `/offers/{id}/decline` | recipient | no body; 200; allocate next eligible candidate atomically |
| GET `/decisions?limit=20&offset=0` | admin | `{items,limit,offset}` with recorded explanations |
| GET `/audit?limit=20&offset=0` | admin | `{items,limit,offset}` |
| GET `/metrics?days=30` | admin | 7, 30, or 90-day recorded cohort metrics; null ratios if denominator is zero |
| POST `/services` | admin | `{name,duration_minutes}`; duration 15–240; 201 `{id}` |
| POST `/members` | admin | `{email,display_name,role:"admin"|"tutor"|"student"}`; invite or update role; 201 `{id:userId}` |
| POST `/tutors` | admin | `{user_id,service_ids:[...]}`; staff membership required; adds subject assignments; 201 `{id}` |
| PATCH `/settings` | admin | `{offer_seconds:900}`; integer 60–86400; new offers only |

Days use Sunday=0 through Saturday=6. Availability is local, recurring, same-day, and must include the complete appointment. Split overnight preferences into separate days. The browser form supports one window per selected day; the API supports up to 28 windows. Times are stored as UTC instants and interpreted with the retained IANA zone.

Idempotency keys contain 8–100 characters and are scoped to user + exact operation. Reusing a key for a different operation yields 409. Concurrent retries serialize through slot/student locks. An accepted offer cannot create a second booking even if a client supplies a new key.

## Errors and bounds

Errors are `{ "error": "message" }`. HTTP 400 = malformed/invalid request, 401 = missing/expired session, 403 = origin/CSRF/role denied, 404 = record absent in the permitted scope, 409 = state/capacity/idempotency conflict, 500 = safe generic server error. Sign-in request throttling preserves the generic 202 response.

Decision/audit pagination defaults to 50, maximum 100, bounded offset 100000. Dashboard projections cap slots/waitlist/members at 300, bookings at 200, offers at 100. Slots include the preceding 30 days and future availability. `GET /healthz` on API port 8080 and worker port 8081 checks database connectivity; it is not a guarantee that SMTP or all allocations are succeeding.
