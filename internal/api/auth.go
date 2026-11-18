package api

import (
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"net/http"
	"strings"
	"time"
)

func (s *Server) requestLink(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Email string `json:"email"`
	}
	if e := decode(w, r, &b); e != nil {
		return e
	}
	if e := s.Auth.Request(r.Context(), b.Email, r.RemoteAddr); e != nil {
		if strings.Contains(e.Error(), "valid email") {
			return badRequest(e.Error())
		}
		return e
	}
	JSON(w, 202, map[string]string{"message": "If this address can receive email, a sign-in link will arrive shortly."})
	return nil
}
func (s *Server) verify(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Token string `json:"token"`
	}
	if e := decode(w, r, &b); e != nil {
		return e
	}
	token, e := s.Auth.Verify(r.Context(), b.Token)
	if e != nil {
		return badRequest("This sign-in link is invalid or expired. Request a new one.")
	}
	http.SetCookie(w, &http.Cookie{Name: "wf_session", Value: token, Path: "/", HttpOnly: true, Secure: s.Config.Production, SameSite: http.SameSiteLaxMode, MaxAge: 7 * 86400})
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	cookie, e := r.Cookie("wf_session")
	if e == nil {
		if e = s.Auth.Logout(r.Context(), cookie.Value); e != nil {
			return e
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "wf_session", Value: "", Path: "/", HttpOnly: true, Secure: s.Config.Production, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	u := identity(r)
	orgs, e := s.rows(r, `SELECT jsonb_build_object('id',o.id,'name',o.name,'timezone',o.timezone,'demo',o.demo,'role',m.role,'offer_seconds',o.offer_seconds) FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.enabled ORDER BY o.name`, u.ID)
	if e != nil {
		return e
	}
	JSON(w, 200, map[string]any{"user": u, "organizations": orgs})
	return nil
}
func (s *Server) profile(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Name          string `json:"display_name"`
		Timezone      string `json:"timezone"`
		Notifications bool   `json:"notifications"`
	}
	if e := decode(w, r, &b); e != nil {
		return e
	}
	b.Name = strings.TrimSpace(b.Name)
	if len(b.Name) < 1 || len(b.Name) > 100 {
		return badRequest("Enter a name between 1 and 100 characters.")
	}
	if _, e := time.LoadLocation(b.Timezone); e != nil {
		return badRequest("Choose a valid IANA time zone.")
	}
	_, e := s.DB.Exec(r.Context(), `UPDATE users SET display_name=$2,timezone=$3,notifications=$4 WHERE id=$1`, identity(r).ID, b.Name, b.Timezone, b.Notifications)
	if e != nil {
		return e
	}
	JSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) error {
	if e := s.Auth.Delete(r.Context(), identity(r).ID); e != nil {
		return badRequest(e.Error())
	}
	return s.logout(w, r)
}
func (s *Server) createOrg(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Name     string `json:"name"`
		Timezone string `json:"timezone"`
	}
	if e := decode(w, r, &b); e != nil {
		return e
	}
	if len(strings.TrimSpace(b.Name)) < 1 || len(b.Name) > 100 {
		return badRequest("Enter an organization name.")
	}
	if _, e := time.LoadLocation(b.Timezone); e != nil {
		return badRequest("Choose a valid IANA time zone.")
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var id string
	if e = tx.QueryRow(r.Context(), `INSERT INTO organizations(name,timezone) VALUES($1,$2) RETURNING id`, b.Name, b.Timezone).Scan(&id); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'admin')`, id, identity(r).ID); e != nil {
		return e
	}
	if e = appointments.Audit(r.Context(), tx, id, identity(r).ID, "OrganizationCreated", id, nil); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	JSON(w, 201, map[string]string{"id": id})
	return nil
}
