package integration_test

import (
	"context"
	"errors"
	"fmt"
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"github.com/REinstall-SyS/WaitlistFair/internal/auth"
	"github.com/REinstall-SyS/WaitlistFair/internal/notifications"
	"github.com/REinstall-SyS/WaitlistFair/internal/testutil"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

func TestFIFOAndExclusionEvidence(t *testing.T) {
	f := testutil.New(t, 4)
	slot := f.Slot(t, f.Start)
	f.Entry(t, f.Students[0], 4, false)
	selected := f.Entry(t, f.Students[1], 3, true)
	f.Entry(t, f.Students[2], 2, true)
	testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, slot))
	_, user := f.Offer(t, slot)
	if user != f.Students[1] {
		t.Fatal("did not select earliest eligible student")
	}
	var entry string
	var considered, excluded int
	testutil.Must(t, f.DB.QueryRow(context.Background(), `SELECT selected_entry_id,(explanation->>'considered')::int,(explanation->>'excluded')::int FROM decisions WHERE slot_id=$1`, slot).Scan(&entry, &considered, &excluded))
	if entry != selected || considered != 3 || excluded != 1 {
		t.Fatalf("invalid decision: %s %d %d", entry, considered, excluded)
	}
	if f.Count(t, `SELECT (explanation->'exclusion_reasons'->>'unavailable')::int FROM decisions WHERE slot_id=$1`, slot) != 1 {
		t.Fatal("missing unavailable reason")
	}
}
func TestPreferencesAreRevalidatedAfterWaitingForStudentLock(t *testing.T) {
	f := testutil.New(t, 2)
	ctx := context.Background()
	slot := f.Slot(t, f.Start)
	entry := f.Entry(t, f.Students[0], 2, true)
	f.Entry(t, f.Students[1], 1, true)
	change, e := f.DB.Begin(ctx)
	testutil.Must(t, e)
	defer change.Rollback(ctx)
	_, e = change.Exec(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, f.Students[0])
	testutil.Must(t, e)
	done := make(chan error, 1)
	go func() { done <- f.Service.Allocate(ctx, f.Org, slot) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		testutil.Must(t, f.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE l.relation='users'::regclass AND a.wait_event_type='Lock')`).Scan(&waiting))
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("allocator did not wait for the earlier student lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	_, e = change.Exec(ctx, `UPDATE waitlist_entries SET preferences='{"timezone":"UTC","windows":[{"day":0,"start":"00:00","end":"00:01"}]}' WHERE id=$1`, entry)
	testutil.Must(t, e)
	testutil.Must(t, change.Commit(ctx))
	testutil.Must(t, <-done)
	_, student := f.Offer(t, slot)
	if student != f.Students[1] {
		t.Fatal("allocator used stale availability after waiting for a lock")
	}
	var snapshot string
	testutil.Must(t, f.DB.QueryRow(ctx, `SELECT explanation->'candidates'->0->'availability_snapshot'->'windows'->0->>'end' FROM decisions WHERE slot_id=$1`, slot).Scan(&snapshot))
	if snapshot != "00:01" {
		t.Fatal("decision did not preserve the revalidated availability")
	}
	_, e = f.DB.Exec(ctx, `UPDATE waitlist_entries SET preferences='{"timezone":"UTC","windows":[]}' WHERE id=$1`, entry)
	testutil.Must(t, e)
	testutil.Must(t, f.DB.QueryRow(ctx, `SELECT explanation->'candidates'->0->'availability_snapshot'->'windows'->0->>'end' FROM decisions WHERE slot_id=$1`, slot).Scan(&snapshot))
	if snapshot != "00:01" {
		t.Fatal("historical decision changed with current preferences")
	}
}
func TestExpiredOffersAdvanceAndCannotAccept(t *testing.T) {
	f := testutil.New(t, 2)
	slot := f.Slot(t, f.Start)
	f.Entry(t, f.Students[0], 2, true)
	f.Entry(t, f.Students[1], 1, true)
	testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, slot))
	offer, user := f.Offer(t, slot)
	_, e := f.DB.Exec(context.Background(), `UPDATE offers SET expires_at=clock_timestamp() WHERE id=$1`, offer)
	testutil.Must(t, e)
	if _, e = f.Service.Accept(context.Background(), f.Actor(user), offer, "expired-accept-key"); !errors.Is(e, appointments.ErrConflict) {
		t.Fatalf("expired acceptance: %v", e)
	}
	testutil.Must(t, f.Service.Expire(context.Background(), f.Org, offer))
	testutil.Must(t, f.Service.Expire(context.Background(), f.Org, offer))
	next, recipient := f.Offer(t, slot)
	if next == offer || recipient != f.Students[1] {
		t.Fatal("expiration did not advance")
	}
	if _, e = f.Service.Accept(context.Background(), f.Actor(user), offer, "replayed-expiry-key"); !errors.Is(e, appointments.ErrConflict) {
		t.Fatal("replayed expired offer accepted")
	}
}
func TestParticipationAndConflictExclusionsAreRecorded(t *testing.T) {
	f := testutil.New(t, 4)
	ctx := context.Background()
	slot := f.Slot(t, f.Start)
	f.Entry(t, f.Students[0], 4, false)
	f.Entry(t, f.Students[1], 3, true)
	f.Entry(t, f.Students[2], 2, true)
	f.Entry(t, f.Students[3], 1, true)
	_, e := f.DB.Exec(ctx, `UPDATE memberships SET enabled=false WHERE organization_id=$1 AND user_id=$2`, f.Org, f.Students[1])
	testutil.Must(t, e)
	conflicting := f.OtherTutorSlot(t, f.Start)
	_, e = f.Service.Book(ctx, f.Actor(f.Students[2]), conflicting, "conflicting-session-key")
	testutil.Must(t, e)
	testutil.Must(t, f.Service.Allocate(ctx, f.Org, slot))
	_, student := f.Offer(t, slot)
	if student != f.Students[3] {
		t.Fatal("selected a student who did not satisfy participation or conflict rules")
	}
	for _, reason := range []string{"unavailable", "participation_disabled", "conflicting_reservation"} {
		if f.Count(t, `SELECT (explanation->'exclusion_reasons'->>$2)::int FROM decisions WHERE slot_id=$1`, slot, reason) != 1 {
			t.Fatalf("missing exclusion reason: %s", reason)
		}
	}
}
func TestRevocationAndDeclineAreTerminal(t *testing.T) {
	for _, state := range []string{"declined", "revoked"} {
		t.Run(state, func(t *testing.T) {
			f := testutil.New(t, 1)
			slot := f.Slot(t, f.Start)
			f.Entry(t, f.Students[0], 1, true)
			testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, slot))
			offer, user := f.Offer(t, slot)
			if state == "declined" {
				testutil.Must(t, f.Service.Decline(context.Background(), f.Actor(user), offer))
				testutil.Must(t, f.Service.Decline(context.Background(), f.Actor(user), offer))
			} else {
				testutil.Must(t, f.Service.Cancel(context.Background(), f.Actor(f.Admin), slot, true, ""))
				testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, slot))
			}
			if _, e := f.Service.Accept(context.Background(), f.Actor(user), offer, "terminal-replay-key"); !errors.Is(e, appointments.ErrConflict) {
				t.Fatalf("accepted terminal offer: %v", e)
			}
			if f.Count(t, `SELECT count(*) FROM offers WHERE slot_id=$1`, slot) != 1 {
				t.Fatal("same student was repeatedly offered same slot")
			}
		})
	}
}
func TestCrossOrganizationAndRecipientAuthorization(t *testing.T) {
	f := testutil.New(t, 2)
	other := testutil.New(t, 1)
	slot := f.Slot(t, f.Start)
	f.Entry(t, f.Students[0], 1, true)
	testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, slot))
	offer, _ := f.Offer(t, slot)
	var secondOrg string
	testutil.Must(t, f.DB.QueryRow(context.Background(), `INSERT INTO organizations(name) VALUES('Second permitted center') RETURNING id`).Scan(&secondOrg))
	_, e := f.DB.Exec(context.Background(), `INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'student')`, secondOrg, f.Students[0])
	testutil.Must(t, e)
	for _, a := range []appointments.Actor{f.Actor(f.Students[1]), other.Actor(other.Students[0]), {UserID: f.Students[0], OrgID: other.Org, Role: "student"}, {UserID: f.Students[0], OrgID: secondOrg, Role: "student"}} {
		if _, e := f.Service.Accept(context.Background(), a, offer, auth.Random()); e == nil {
			t.Fatal("unauthorized offer accepted")
		}
	}
	code, _, e := f.Request(f.Students[0], "GET", fmt.Sprintf("/api/orgs/%s/decisions", f.Org), nil, "")
	testutil.Must(t, e)
	if code != 403 {
		t.Fatalf("student read administrator evidence: %d", code)
	}
	code, body, e := f.Request(f.Students[1], "GET", fmt.Sprintf("/api/orgs/%s/dashboard", f.Org), nil, "")
	testutil.Must(t, e)
	if code != 200 || len(body["offers"].([]any)) != 0 || len(body["waitlist"].([]any)) != 0 {
		t.Fatal("private student data leaked")
	}
}
func TestMagicLinkReplaySessionRevocationAndCSRF(t *testing.T) {
	f := testutil.New(t, 1)
	service := &auth.Service{DB: f.DB, AppURL: "http://localhost:3000"}
	var email string
	testutil.Must(t, f.DB.QueryRow(context.Background(), `SELECT email FROM users WHERE id=$1`, f.Students[0]).Scan(&email))
	testutil.Must(t, service.Request(context.Background(), email, "127.0.0.1:3000"))
	token := auth.Random()
	_, e := f.DB.Exec(context.Background(), `INSERT INTO magic_tokens(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 minute')`, auth.Hash(token), f.Students[0])
	testutil.Must(t, e)
	session, e := service.Verify(context.Background(), token)
	testutil.Must(t, e)
	if _, e = service.Verify(context.Background(), token); e == nil {
		t.Fatal("magic token replayed")
	}
	_, e = service.Session(context.Background(), session)
	testutil.Must(t, e)
	testutil.Must(t, service.Logout(context.Background(), session))
	if _, e = service.Session(context.Background(), session); e == nil {
		t.Fatal("revoked session remained valid")
	}
	user := f.Students[0]
	f.CSRF[user] = "wrong-token"
	code, _, e := f.Request(user, "PATCH", "/api/account", map[string]any{"display_name": "Changed", "timezone": "UTC", "notifications": true}, "")
	testutil.Must(t, e)
	if code != 403 {
		t.Fatalf("CSRF accepted: %d", code)
	}
}

type countingSender struct {
	sent atomic.Int32
	fail bool
}

func (s *countingSender) Send(context.Context, string, notifications.Message) error {
	if s.fail {
		return errors.New("SMTP unavailable")
	}
	s.sent.Add(1)
	return nil
}
func TestNotificationCrashAfterBusinessCommit(t *testing.T) {
	f := testutil.New(t, 1)
	slot := f.Slot(t, f.Start)
	f.Entry(t, f.Students[0], 1, true)
	testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, slot))
	sender := &countingSender{}
	w := &notifications.Worker{DB: f.DB, Appointments: f.Service, Sender: sender, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	job, e := w.Claim(context.Background())
	testutil.Must(t, e)
	if job == nil {
		t.Fatal("business commit did not persist notification")
	}
	testutil.Must(t, sender.Send(context.Background(), job.ID, notifications.Message{}))
	_, e = f.DB.Exec(context.Background(), `UPDATE outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, job.ID)
	testutil.Must(t, e)
	retry, e := w.Claim(context.Background())
	testutil.Must(t, e)
	if retry == nil || retry.ID != job.ID {
		t.Fatal("crashed lease was not recovered")
	}
	testutil.Must(t, w.Deliver(context.Background(), retry))
	if sender.sent.Load() != 2 {
		t.Fatal("test did not exercise duplicate external delivery")
	}
	if f.Count(t, `SELECT count(*) FROM offers WHERE slot_id=$1 AND state='pending'`, slot) != 1 {
		t.Fatal("delivery retry changed business state")
	}
}
func TestNotificationBackoffAndTerminalFailure(t *testing.T) {
	f := testutil.New(t, 1)
	sender := &countingSender{fail: true}
	w := &notifications.Worker{DB: f.DB, Appointments: f.Service, Sender: sender, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	_, e := f.DB.Exec(context.Background(), `INSERT INTO outbox(event_type,payload) VALUES('test','{"to":"fixture@fixture.test","subject":"test","body":"test"}')`)
	testutil.Must(t, e)
	for i := 0; i < 8; i++ {
		job, e := w.Claim(context.Background())
		testutil.Must(t, e)
		if job == nil {
			t.Fatal("expected job")
		}
		if w.Deliver(context.Background(), job) == nil {
			t.Fatal("expected SMTP failure")
		}
		_, e = f.DB.Exec(context.Background(), `UPDATE outbox SET next_attempt_at=clock_timestamp() WHERE id=$1`, job.ID)
		testutil.Must(t, e)
	}
	if f.Count(t, `SELECT count(*) FROM outbox WHERE event_type='test' AND state='dead'`) < 1 {
		t.Fatal("missing terminal dead-letter event")
	}
}
func TestDatabaseConstraintsRejectBypass(t *testing.T) {
	f := testutil.New(t, 2)
	first := f.Slot(t, f.Start)
	second := f.OtherTutorSlot(t, f.Start)
	_, e := f.Service.Book(context.Background(), f.Actor(f.Students[0]), first, "first-booking-key")
	testutil.Must(t, e)
	if _, e = f.Service.Book(context.Background(), f.Actor(f.Students[0]), second, "overlap-booking-key"); !errors.Is(e, appointments.ErrConflict) {
		t.Fatalf("overlapping booking allowed: %v", e)
	}
	if _, e = f.Service.Book(context.Background(), f.Actor(f.Students[1]), first, "double-booking-key"); !errors.Is(e, appointments.ErrConflict) {
		t.Fatal("double booking allowed")
	}
}
func TestPendingOfferBlocksOverlappingBooking(t *testing.T) {
	f := testutil.New(t, 1)
	first := f.Slot(t, f.Start)
	second := f.OtherTutorSlot(t, f.Start.Add(15*time.Minute))
	f.Entry(t, f.Students[0], 1, true)
	testutil.Must(t, f.Service.Allocate(context.Background(), f.Org, first))
	if _, e := f.Service.Book(context.Background(), f.Actor(f.Students[0]), second, "pending-overlap-key"); !errors.Is(e, appointments.ErrConflict) {
		t.Fatal("pending offer failed to reserve student time")
	}
}
func TestCancellationRetryCannotCancelReplacementBooking(t *testing.T) {
	f := testutil.New(t, 2)
	ctx := context.Background()
	slot := f.Slot(t, f.Start)
	f.Entry(t, f.Students[0], 1, true)
	original, e := f.Service.Book(ctx, f.Actor(f.Students[1]), slot, "original-booking-key")
	testutil.Must(t, e)
	testutil.Must(t, f.Service.Cancel(ctx, f.Actor(f.Admin), slot, false, original))
	offer, user := f.Offer(t, slot)
	replacement, e := f.Service.Accept(ctx, f.Actor(user), offer, "replacement-accept-key")
	testutil.Must(t, e)
	testutil.Must(t, f.Service.Cancel(ctx, f.Actor(f.Admin), slot, false, original))
	if f.Count(t, `SELECT count(*) FROM bookings WHERE id=$1 AND state='confirmed'`, replacement) != 1 {
		t.Fatal("a cancellation retry canceled the replacement student's booking")
	}
	code, _, e := f.Request(f.Admin, "POST", fmt.Sprintf("/api/orgs/%s/slots/%s/cancel", f.Org, slot), map[string]string{"booking_id": original}, "retried-cancellation-key")
	testutil.Must(t, e)
	if code != 200 || f.Count(t, `SELECT count(*) FROM bookings WHERE id=$1 AND state='confirmed'`, replacement) != 1 {
		t.Fatal("HTTP cancellation retry changed the replacement booking")
	}
}
