package api

import (
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

func (s *Server) createSlot(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if a.Role == "student" {
		return appointments.ErrForbidden
	}
	var b struct {
		TutorID   string    `json:"tutor_id"`
		ServiceID string    `json:"service_id"`
		StartsAt  time.Time `json:"starts_at"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	if !validID(b.TutorID) || !validID(b.ServiceID) {
		return badRequest("Choose a tutor and subject.")
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if e = appointments.Authorize(r.Context(), tx, a); e != nil {
		return e
	}
	var duration int
	var tutorUser string
	var future bool
	if e = tx.QueryRow(r.Context(), `SELECT v.duration_minutes,t.user_id,$4::timestamptz>clock_timestamp() FROM tutor_services ts JOIN services v ON v.id=ts.service_id JOIN tutors t ON t.id=ts.tutor_id WHERE ts.organization_id=$1 AND ts.tutor_id=$2 AND ts.service_id=$3`, a.OrgID, b.TutorID, b.ServiceID, b.StartsAt).Scan(&duration, &tutorUser, &future); e != nil {
		return badRequest("This tutor does not teach the selected subject.")
	}
	if a.Role == "tutor" && tutorUser != a.UserID {
		return appointments.ErrForbidden
	}
	if !future || b.StartsAt.After(time.Now().AddDate(1, 0, 0)) {
		return badRequest("Choose a future time within the next year.")
	}
	var id string
	if e = tx.QueryRow(r.Context(), `INSERT INTO slots(organization_id,tutor_id,service_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING id`, a.OrgID, b.TutorID, b.ServiceID, b.StartsAt, b.StartsAt.Add(time.Duration(duration)*time.Minute)).Scan(&id); e != nil {
		return appointments.ErrConflict
	}
	if e = appointments.Audit(r.Context(), tx, a.OrgID, a.UserID, "SlotCreated", id, nil); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 201, map[string]string{"id": id})
	return nil
}
func (s *Server) createService(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	var b struct {
		Name     string `json:"name"`
		Duration int    `json:"duration_minutes"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	if len(strings.TrimSpace(b.Name)) < 1 || len(b.Name) > 100 || b.Duration < 15 || b.Duration > 240 {
		return badRequest("Enter a subject name and duration of 15–240 minutes.")
	}
	var id string
	e = s.DB.QueryRow(r.Context(), `INSERT INTO services(organization_id,name,duration_minutes) VALUES($1,$2,$3) ON CONFLICT(organization_id,name) DO NOTHING RETURNING id`, a.OrgID, b.Name, b.Duration).Scan(&id)
	if e != nil {
		return appointments.ErrConflict
	}
	JSON(w, 201, map[string]string{"id": id})
	return nil
}
func (s *Server) addMember(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	var b struct {
		Email string `json:"email"`
		Name  string `json:"display_name"`
		Role  string `json:"role"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	address, e := mail.ParseAddress(b.Email)
	if e != nil || address.Address != b.Email || len(b.Email) > 254 || len(strings.TrimSpace(b.Name)) < 1 || len(b.Name) > 100 {
		return badRequest("Enter a valid name and email.")
	}
	if b.Role != "admin" && b.Role != "tutor" && b.Role != "student" {
		return badRequest("Choose a valid role.")
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), `SELECT id FROM organizations WHERE id=$1 FOR UPDATE`, a.OrgID); e != nil {
		return e
	}
	if e = appointments.Authorize(r.Context(), tx, a); e != nil {
		return e
	}
	var user string
	if e = tx.QueryRow(r.Context(), `INSERT INTO users(email,display_name) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`, b.Email, b.Name).Scan(&user); e != nil {
		return e
	}
	if user == a.UserID && b.Role != "admin" {
		return badRequest("Another administrator must manage your role.")
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,enabled=true`, a.OrgID, user, b.Role); e != nil {
		return e
	}
	if e = appointments.Audit(r.Context(), tx, a.OrgID, a.UserID, "MembershipUpdated", user, map[string]string{"role": b.Role}); e != nil {
		return e
	}
	if e = appointments.Event(r.Context(), tx, "MemberInvited", map[string]string{"to": b.Email, "subject": "You have been invited to WaitlistFair", "body": "Your tutoring center added you to WaitlistFair. Sign in with this email at " + s.Config.AppURL + "/login"}); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 201, map[string]string{"id": user})
	return nil
}
func (s *Server) addTutor(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	var b struct {
		UserID     string   `json:"user_id"`
		ServiceIDs []string `json:"service_ids"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	if !validID(b.UserID) || len(b.ServiceIDs) < 1 || len(b.ServiceIDs) > 20 {
		return badRequest("Choose a staff member and 1–20 subjects.")
	}
	for _, id := range b.ServiceIDs {
		if !validID(id) {
			return badRequest("Invalid subject.")
		}
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var eligible bool
	if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND role IN ('admin','tutor') AND enabled)`, a.OrgID, b.UserID).Scan(&eligible); e != nil {
		return e
	}
	if !eligible {
		return badRequest("Add this person as tutor or admin first.")
	}
	var id string
	if e = tx.QueryRow(r.Context(), `INSERT INTO tutors(organization_id,user_id) VALUES($1,$2) ON CONFLICT(organization_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id`, a.OrgID, b.UserID).Scan(&id); e != nil {
		return e
	}
	for _, service := range b.ServiceIDs {
		if _, e = tx.Exec(r.Context(), `INSERT INTO tutor_services(tutor_id,service_id,organization_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, id, service, a.OrgID); e != nil {
			return badRequest("Subjects must belong to this organization.")
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 201, map[string]string{"id": id})
	return nil
}
func (s *Server) orgSettings(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	var b struct {
		OfferSeconds int `json:"offer_seconds"`
	}
	if e = decode(w, r, &b); e != nil {
		return e
	}
	if b.OfferSeconds < 60 || b.OfferSeconds > 86400 {
		return badRequest("Offer windows must be between 1 minute and 24 hours.")
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), `UPDATE organizations SET offer_seconds=$2 WHERE id=$1`, a.OrgID, b.OfferSeconds); e != nil {
		return e
	}
	if e = appointments.Audit(r.Context(), tx, a.OrgID, a.UserID, "OfferWindowUpdated", a.OrgID, map[string]int{"offer_seconds": b.OfferSeconds}); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
