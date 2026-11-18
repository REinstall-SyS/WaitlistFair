package api

import (
	"encoding/json"
	"github.com/REinstall-SyS/WaitlistFair/internal/allocation"
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"net/http"
)

func (s *Server) book(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	id, e := pathID(r)
	if e != nil {
		return e
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 8 || len(key) > 100 {
		return badRequest("Include an Idempotency-Key of 8 to 100 characters.")
	}
	result, e := s.Appointments.Book(r.Context(), a, id, key)
	if e != nil {
		return e
	}
	JSON(w, 201, map[string]string{"id": result})
	return nil
}
func (s *Server) accept(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	id, e := pathID(r)
	if e != nil {
		return e
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 8 || len(key) > 100 {
		return badRequest("Include an Idempotency-Key of 8 to 100 characters.")
	}
	result, e := s.Appointments.Accept(r.Context(), a, id, key)
	if e != nil {
		return e
	}
	JSON(w, 200, map[string]string{"id": result})
	return nil
}
func (s *Server) decline(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	id, e := pathID(r)
	if e != nil {
		return e
	}
	if e = s.Appointments.Decline(r.Context(), a, id); e != nil {
		return e
	}
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (s *Server) cancel(w http.ResponseWriter, r *http.Request) error {
	return s.cancelAction(w, r, false)
}
func (s *Server) closeSlot(w http.ResponseWriter, r *http.Request) error {
	return s.cancelAction(w, r, true)
}
func (s *Server) cancelAction(w http.ResponseWriter, r *http.Request, close bool) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	id, e := pathID(r)
	if e != nil {
		return e
	}
	var bookingID string
	if !close {
		var body struct {
			BookingID string `json:"booking_id"`
		}
		if e = decode(w, r, &body); e != nil {
			return e
		}
		if !validID(body.BookingID) {
			return badRequest("Choose the booking to cancel.")
		}
		bookingID = body.BookingID
	}
	if e = s.Appointments.Cancel(r.Context(), a, id, close, bookingID); e != nil {
		return e
	}
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (s *Server) joinWaitlist(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if a.Role != "student" {
		return appointments.ErrForbidden
	}
	var b struct {
		ServiceID   string                 `json:"service_id"`
		Preferences allocation.Preferences `json:"preferences"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	if !validID(b.ServiceID) {
		return badRequest("Choose a subject.")
	}
	if e = b.Preferences.Validate(); e != nil {
		return badRequest(e.Error())
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if e = appointments.Authorize(r.Context(), tx, a); e != nil {
		return e
	}
	var exists bool
	if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM services WHERE id=$1 AND organization_id=$2)`, b.ServiceID, a.OrgID).Scan(&exists); e != nil {
		return e
	}
	if !exists {
		return appointments.ErrNotFound
	}
	raw, _ := json.Marshal(b.Preferences)
	var id string
	if e = tx.QueryRow(r.Context(), `INSERT INTO waitlist_entries(organization_id,student_id,service_id,preferences) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,student_id,service_id) WHERE(status IN ('active','paused')) DO NOTHING RETURNING id`, a.OrgID, a.UserID, b.ServiceID, raw).Scan(&id); e != nil {
		return appointments.ErrConflict
	}
	if _, e = tx.Exec(r.Context(), `UPDATE slots SET allocation_requested=true WHERE organization_id=$1 AND service_id=$2 AND state='available' AND canceled_at IS NOT NULL AND starts_at>clock_timestamp()`, a.OrgID, b.ServiceID); e != nil {
		return e
	}
	if e = appointments.Audit(r.Context(), tx, a.OrgID, a.UserID, "WaitlistJoined", id, nil); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 201, map[string]string{"id": id})
	return nil
}
func (s *Server) updateWaitlist(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	id, e := pathID(r)
	if e != nil {
		return e
	}
	var b struct {
		Status      string                  `json:"status"`
		Preferences *allocation.Preferences `json:"preferences,omitempty"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	if b.Status != "active" && b.Status != "paused" && b.Status != "withdrawn" {
		return badRequest("Choose active, paused, or withdrawn.")
	}
	if b.Preferences != nil {
		if e = b.Preferences.Validate(); e != nil {
			return badRequest(e.Error())
		}
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), `SELECT id FROM users WHERE id=$1 FOR UPDATE`, a.UserID); e != nil {
		return e
	}
	var student, status string
	var pending bool
	if e = tx.QueryRow(r.Context(), `SELECT student_id,status,EXISTS(SELECT 1 FROM offers WHERE entry_id=$1 AND state='pending') FROM waitlist_entries WHERE id=$1 AND organization_id=$2 FOR UPDATE`, id, a.OrgID).Scan(&student, &status, &pending); e != nil {
		return appointments.ErrNotFound
	}
	if student != a.UserID {
		return appointments.ErrForbidden
	}
	if pending {
		return badRequest("Respond to your active offer before changing this waitlist entry.")
	}
	if status != "active" && status != "paused" {
		return appointments.ErrConflict
	}
	var raw any
	if b.Preferences != nil {
		raw, _ = json.Marshal(b.Preferences)
	}
	if _, e = tx.Exec(r.Context(), `UPDATE waitlist_entries SET status=$2,preferences=COALESCE($3::jsonb,preferences) WHERE id=$1`, id, b.Status, raw); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), `UPDATE slots SET allocation_requested=true WHERE organization_id=$1 AND service_id=(SELECT service_id FROM waitlist_entries WHERE id=$2) AND state='available' AND canceled_at IS NOT NULL`, a.OrgID, id); e != nil {
		return e
	}
	if e = appointments.Audit(r.Context(), tx, a.OrgID, a.UserID, "WaitlistUpdated", id, map[string]string{"status": b.Status}); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
