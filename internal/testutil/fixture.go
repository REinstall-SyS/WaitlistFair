package testutil

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/REinstall-SyS/WaitlistFair/internal/api"
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"github.com/REinstall-SyS/WaitlistFair/internal/auth"
	"github.com/REinstall-SyS/WaitlistFair/internal/config"
	"github.com/REinstall-SyS/WaitlistFair/internal/persistence"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"os"
	"testing"
	"time"
)

type Fixture struct {
	DB                           *pgxpool.Pool
	Service                      *appointments.Service
	Server                       *httptest.Server
	Org, ServiceID, Tutor, Admin string
	Students                     []string
	Tokens                       map[string]string
	CSRF                         map[string]string
	Start                        time.Time
}

func New(t *testing.T, students int) *Fixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is required for real PostgreSQL integration tests")
	}
	ctx := context.Background()
	db, e := persistence.Open(ctx, url)
	Must(t, e)
	t.Cleanup(db.Close)
	Must(t, persistence.Migrate(ctx, db))
	schema := "wf_test_" + auth.Random()[:16]
	_, e = db.Exec(ctx, `CREATE SCHEMA `+schema)
	Must(t, e)
	_, e = db.Exec(ctx, `CREATE TABLE `+schema+`.schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`)
	Must(t, e)
	baseDB := db
	t.Cleanup(func() { _, _ = baseDB.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`) })
	parsed, e := neturl.Parse(url)
	Must(t, e)
	query := parsed.Query()
	query.Set("search_path", schema+",public")
	parsed.RawQuery = query.Encode()
	db, e = persistence.Open(ctx, parsed.String())
	Must(t, e)
	t.Cleanup(db.Close)
	Must(t, persistence.Migrate(ctx, db))
	f := &Fixture{DB: db, Tokens: map[string]string{}, CSRF: map[string]string{}, Start: time.Now().UTC().Truncate(time.Hour).Add(48 * time.Hour)}
	Must(t, db.QueryRow(ctx, `INSERT INTO organizations(name,timezone,offer_seconds) VALUES('Integration fixture','UTC',60) RETURNING id`).Scan(&f.Org))
	for i := 0; i <= students; i++ {
		var id string
		Must(t, db.QueryRow(ctx, `INSERT INTO users(email,display_name,timezone) VALUES(gen_random_uuid()::text||'@fixture.test','Fixture user','UTC') RETURNING id`).Scan(&id))
		role := "student"
		if i == 0 {
			role = "admin"
			f.Admin = id
		} else {
			f.Students = append(f.Students, id)
		}
		_, e = db.Exec(ctx, `INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3)`, f.Org, id, role)
		Must(t, e)
		token, csrf := auth.Random(), auth.Random()
		f.Tokens[id] = token
		f.CSRF[id] = csrf
		_, e = db.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`, auth.Hash(token), id, csrf)
		Must(t, e)
	}
	Must(t, db.QueryRow(ctx, `INSERT INTO services(organization_id,name,duration_minutes) VALUES($1,'Calculus fixture',45) RETURNING id`, f.Org).Scan(&f.ServiceID))
	Must(t, db.QueryRow(ctx, `INSERT INTO tutors(organization_id,user_id) VALUES($1,$2) RETURNING id`, f.Org, f.Admin).Scan(&f.Tutor))
	_, e = db.Exec(ctx, `INSERT INTO tutor_services(tutor_id,service_id,organization_id) VALUES($1,$2,$3)`, f.Tutor, f.ServiceID, f.Org)
	Must(t, e)
	f.Service = &appointments.Service{DB: db, AppURL: "http://localhost:3000"}
	server := &api.Server{DB: db, Config: config.Config{AppURL: "http://localhost:3000"}, Appointments: f.Service, Auth: &auth.Service{DB: db, AppURL: "http://localhost:3000"}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	f.Server = httptest.NewServer(server.Handler())
	t.Cleanup(f.Server.Close)
	return f
}
func Must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func (f *Fixture) Actor(user string) appointments.Actor {
	role := "student"
	if user == f.Admin {
		role = "admin"
	}
	return appointments.Actor{UserID: user, OrgID: f.Org, Role: role}
}
func (f *Fixture) Slot(t *testing.T, start time.Time) string {
	t.Helper()
	var id string
	Must(t, f.DB.QueryRow(context.Background(), `INSERT INTO slots(organization_id,tutor_id,service_id,starts_at,ends_at,canceled_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()) RETURNING id`, f.Org, f.Tutor, f.ServiceID, start, start.Add(45*time.Minute)).Scan(&id))
	return id
}
func (f *Fixture) OtherTutorSlot(t *testing.T, start time.Time) string {
	t.Helper()
	var tutor string
	var user string
	Must(t, f.DB.QueryRow(context.Background(), `INSERT INTO users(email,display_name) VALUES(gen_random_uuid()::text||'@fixture.test','Other tutor') RETURNING id`).Scan(&user))
	Must(t, f.DB.QueryRow(context.Background(), `INSERT INTO tutors(organization_id,user_id) VALUES($1,$2) RETURNING id`, f.Org, user).Scan(&tutor))
	_, e := f.DB.Exec(context.Background(), `INSERT INTO tutor_services(tutor_id,service_id,organization_id) VALUES($1,$2,$3)`, tutor, f.ServiceID, f.Org)
	Must(t, e)
	var id string
	Must(t, f.DB.QueryRow(context.Background(), `INSERT INTO slots(organization_id,tutor_id,service_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING id`, f.Org, tutor, f.ServiceID, start, start.Add(45*time.Minute)).Scan(&id))
	return id
}
func (f *Fixture) Entry(t *testing.T, user string, joined int, available bool) string {
	t.Helper()
	windows := []map[string]any{}
	for d := 0; d < 7; d++ {
		start, end := "00:00", "23:59"
		if !available {
			start, end = "00:00", "00:01"
		}
		windows = append(windows, map[string]any{"day": d, "start": start, "end": end})
	}
	b, _ := json.Marshal(map[string]any{"timezone": "UTC", "windows": windows})
	var id string
	Must(t, f.DB.QueryRow(context.Background(), `INSERT INTO waitlist_entries(organization_id,student_id,service_id,preferences,joined_at) VALUES($1,$2,$3,$4,clock_timestamp()-make_interval(hours=>$5)) RETURNING id`, f.Org, user, f.ServiceID, b, joined).Scan(&id))
	return id
}
func (f *Fixture) Offer(t *testing.T, slot string) (string, string) {
	t.Helper()
	var id, user string
	Must(t, f.DB.QueryRow(context.Background(), `SELECT id,recipient_id FROM offers WHERE slot_id=$1 AND state='pending'`, slot).Scan(&id, &user))
	return id, user
}
func (f *Fixture) Request(user, method, path string, body any, key string) (int, map[string]any, error) {
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	r, e := http.NewRequest(method, f.Server.URL+path, bytes.NewReader(b))
	if e != nil {
		return 0, nil, e
	}
	r.Header.Set("Origin", "http://localhost:3000")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", f.CSRF[user])
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	r.AddCookie(&http.Cookie{Name: "wf_session", Value: f.Tokens[user]})
	response, e := f.Server.Client().Do(r)
	if e != nil {
		return 0, nil, e
	}
	defer response.Body.Close()
	var data map[string]any
	e = json.NewDecoder(response.Body).Decode(&data)
	return response.StatusCode, data, e
}
func (f *Fixture) Count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	Must(t, f.DB.QueryRow(context.Background(), query, args...).Scan(&n))
	return n
}
