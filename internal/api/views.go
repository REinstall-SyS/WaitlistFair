package api

import (
	"net/http"
	"strconv"
)

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	ctx := r.Context()
	var now string
	if e = s.DB.QueryRow(ctx, `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`).Scan(&now); e != nil {
		return e
	}
	data := map[string]any{"server_time": now}
	queries := []struct {
		key, sql string
		args     []any
	}{
		{"services", `SELECT to_jsonb(v) FROM services v WHERE organization_id=$1 ORDER BY name`, []any{a.OrgID}},
		{"tutors", `SELECT jsonb_build_object('id',t.id,'user_id',t.user_id,'display_name',u.display_name,'service_ids',COALESCE((SELECT jsonb_agg(service_id) FROM tutor_services WHERE tutor_id=t.id),'[]')) FROM tutors t JOIN users u ON u.id=t.user_id WHERE t.organization_id=$1 ORDER BY u.display_name`, []any{a.OrgID}},
		{"slots", `SELECT jsonb_build_object('id',s.id,'booking_id',(SELECT b.id FROM bookings b WHERE b.slot_id=s.id AND b.state='confirmed' AND ($2 IN ('admin','tutor') OR b.student_id=$3)),'service_id',s.service_id,'tutor_id',s.tutor_id,'starts_at',s.starts_at,'ends_at',s.ends_at,'state',s.state,'subject',v.name,'tutor',u.display_name,'canceled_at',s.canceled_at,'allocation_requested',s.allocation_requested) FROM slots s JOIN services v ON v.id=s.service_id JOIN tutors t ON t.id=s.tutor_id JOIN users u ON u.id=t.user_id WHERE s.organization_id=$1 AND ($2<>'tutor' OR t.user_id=$3) AND s.starts_at>clock_timestamp()-interval '30 days' ORDER BY s.starts_at LIMIT 300`, []any{a.OrgID, a.Role, a.UserID}},
		{"bookings", `SELECT jsonb_build_object('id',b.id,'slot_id',s.id,'state',b.state,'created_at',b.created_at,'starts_at',s.starts_at,'ends_at',s.ends_at,'subject',v.name,'tutor',tu.display_name,'student',u.display_name) FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN services v ON v.id=s.service_id JOIN tutors t ON t.id=s.tutor_id JOIN users tu ON tu.id=t.user_id JOIN users u ON u.id=b.student_id WHERE b.organization_id=$1 AND ($2='admin' OR ($2='tutor' AND t.user_id=$3) OR b.student_id=$3) ORDER BY s.starts_at DESC LIMIT 200`, []any{a.OrgID, a.Role, a.UserID}},
		{"offers", `SELECT jsonb_build_object('id',o.id,'slot_id',s.id,'state',o.state,'created_at',o.created_at,'expires_at',o.expires_at,'starts_at',s.starts_at,'ends_at',s.ends_at,'subject',v.name,'tutor',u.display_name,'explanation','You were next among eligible students who could attend this appointment.') FROM offers o JOIN slots s ON s.id=o.slot_id JOIN services v ON v.id=s.service_id JOIN tutors t ON t.id=s.tutor_id JOIN users u ON u.id=t.user_id WHERE o.organization_id=$1 AND ($2='admin' OR o.recipient_id=$3) ORDER BY o.created_at DESC LIMIT 100`, []any{a.OrgID, a.Role, a.UserID}},
		{"waitlist", `SELECT jsonb_build_object('id',w.id,'student_id',w.student_id,'subject',v.name,'status',w.status,'joined_at',w.joined_at,'preferences',w.preferences,'display_name',u.display_name,'email',u.email,'queue_ahead',(SELECT count(*) FROM waitlist_entries x WHERE x.organization_id=w.organization_id AND x.service_id=w.service_id AND x.status='active' AND (x.joined_at,x.id)<(w.joined_at,w.id))) FROM waitlist_entries w JOIN services v ON v.id=w.service_id JOIN users u ON u.id=w.student_id WHERE w.organization_id=$1 AND ($2='admin' OR w.student_id=$3) ORDER BY w.joined_at,w.id LIMIT 300`, []any{a.OrgID, a.Role, a.UserID}},
	}
	for _, q := range queries {
		rows, e := s.rows(r, q.sql, q.args...)
		if e != nil {
			return e
		}
		data[q.key] = rows
	}
	if a.Role == "admin" {
		members, e := s.rows(r, `SELECT jsonb_build_object('id',u.id,'display_name',u.display_name,'email',u.email,'role',m.role,'enabled',m.enabled) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.display_name LIMIT 300`, a.OrgID)
		if e != nil {
			return e
		}
		data["members"] = members
	}
	JSON(w, 200, data)
	return nil
}
func (s *Server) decisions(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	limit, offset := pagination(r)
	rows, e := s.rows(r, `SELECT jsonb_build_object('id',d.id,'slot_id',d.slot_id,'created_at',d.created_at,'policy_version',d.policy_version,'selected_entry_id',d.selected_entry_id,'explanation',d.explanation,'subject',v.name,'starts_at',s.starts_at,'offer_state',(SELECT state FROM offers WHERE decision_id=d.id LIMIT 1)) FROM decisions d JOIN slots s ON s.id=d.slot_id JOIN services v ON v.id=s.service_id WHERE d.organization_id=$1 ORDER BY d.created_at DESC,d.id LIMIT $2 OFFSET $3`, a.OrgID, limit, offset)
	if e != nil {
		return e
	}
	JSON(w, 200, map[string]any{"items": rows, "limit": limit, "offset": offset})
	return nil
}
func (s *Server) audit(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	limit, offset := pagination(r)
	rows, e := s.rows(r, `SELECT jsonb_build_object('id',e.id,'action',e.action,'target_id',e.target_id,'actor',COALESCE(u.display_name,'WaitlistFair worker'),'created_at',e.created_at,'metadata',e.metadata) FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT $2 OFFSET $3`, a.OrgID, limit, offset)
	if e != nil {
		return e
	}
	JSON(w, 200, map[string]any{"items": rows, "limit": limit, "offset": offset})
	return nil
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) error {
	a, e := s.actor(r)
	if e != nil {
		return e
	}
	if e = requireAdmin(a); e != nil {
		return e
	}
	days := 30
	if n, e := strconv.Atoi(r.URL.Query().Get("days")); e == nil && (n == 7 || n == 30 || n == 90) {
		days = n
	}
	rows, e := s.rows(r, `WITH canceled AS(SELECT * FROM slots WHERE organization_id=$1 AND canceled_at>=clock_timestamp()-make_interval(days=>$2)),refilled AS(SELECT c.id,min(b.created_at) AS refill_at,c.canceled_at FROM canceled c JOIN bookings b ON b.slot_id=c.id AND b.state='confirmed' AND b.created_at>=c.canceled_at GROUP BY c.id,c.canceled_at),o AS(SELECT * FROM offers WHERE organization_id=$1 AND created_at>=clock_timestamp()-make_interval(days=>$2)) SELECT jsonb_build_object('days',$2::int,'canceled',(SELECT count(*) FROM canceled),'refilled',(SELECT count(*) FROM refilled),'unfilled',(SELECT count(*) FROM canceled WHERE state IN ('available','offer_pending')),'refill_rate',(SELECT round(100.0*(SELECT count(*) FROM refilled)/NULLIF(count(*),0),1) FROM canceled),'median_refill_seconds',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM refill_at-canceled_at)) FROM refilled),'offers',(SELECT count(*) FROM o),'accepted',(SELECT count(*) FROM o WHERE state='accepted'),'expired',(SELECT count(*) FROM o WHERE state='expired'),'acceptance_rate',(SELECT round(100.0*count(*) FILTER(WHERE state='accepted')/NULLIF(count(*),0),1) FROM o),'expired_rate',(SELECT round(100.0*count(*) FILTER(WHERE state='expired')/NULLIF(count(*),0),1) FROM o),'offers_per_refill',(SELECT round(count(*)::numeric/NULLIF((SELECT count(*) FROM refilled),0),2) FROM o))`, a.OrgID, days)
	if e != nil {
		return e
	}
	JSON(w, 200, rows[0])
	return nil
}
