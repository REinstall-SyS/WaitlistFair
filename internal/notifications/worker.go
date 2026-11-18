package notifications

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"github.com/REinstall-SyS/WaitlistFair/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

type Message struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}
type Sender interface {
	Send(context.Context, string, Message) error
}
type SMTP struct{ Config config.Config }

func (s SMTP) Send(ctx context.Context, id string, m Message) error {
	from, e := mail.ParseAddress(s.Config.MailFrom)
	if e != nil {
		return e
	}
	to, e := mail.ParseAddress(m.To)
	if e != nil {
		return e
	}
	if strings.ContainsAny(m.Subject, "\r\n") {
		return fmt.Errorf("invalid subject")
	}
	host, _, e := net.SplitHostPort(s.Config.SMTPAddr)
	if e != nil {
		return e
	}
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, e := dialer.DialContext(ctx, "tcp", s.Config.SMTPAddr)
	if e != nil {
		return e
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	client, e := smtp.NewClient(conn, host)
	if e != nil {
		return e
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); ok {
		if e = client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); e != nil {
			return e
		}
	} else if s.Config.Production {
		return fmt.Errorf("production SMTP requires STARTTLS")
	}
	if s.Config.SMTPUser != "" {
		if e = client.Auth(smtp.PlainAuth("", s.Config.SMTPUser, s.Config.SMTPPassword, host)); e != nil {
			return e
		}
	}
	if e = client.Mail(from.Address); e != nil {
		return e
	}
	if e = client.Rcpt(to.Address); e != nil {
		return e
	}
	w, e := client.Data()
	if e != nil {
		return e
	}
	content := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMessage-ID: <%s@waitlistfair.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", from.String(), to.String(), m.Subject, id, strings.ReplaceAll(m.Body, "\n", "\r\n"))
	if _, e = w.Write([]byte(content)); e != nil {
		return e
	}
	if e = w.Close(); e != nil {
		return e
	}
	return client.Quit()
}

type Worker struct {
	DB           *pgxpool.Pool
	Appointments *appointments.Service
	Sender       Sender
	Log          *slog.Logger
}
type Job struct {
	ID, Lease string
	Payload   []byte
	Attempts  int
}

func (w *Worker) Claim(ctx context.Context) (*Job, error) {
	var j Job
	e := w.DB.QueryRow(ctx, `WITH candidate AS (SELECT id FROM outbox WHERE (state='ready' AND next_attempt_at<=clock_timestamp()) OR (state='processing' AND lease_until<clock_timestamp()) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE outbox o SET state='processing',lease_until=clock_timestamp()+interval '30 seconds',lease_token=gen_random_uuid(),attempts=attempts+1 FROM candidate c WHERE o.id=c.id RETURNING o.id,o.lease_token,o.payload,o.attempts`).Scan(&j.ID, &j.Lease, &j.Payload, &j.Attempts)
	if e == pgx.ErrNoRows {
		return nil, nil
	}
	return &j, e
}
func (w *Worker) Deliver(ctx context.Context, j *Job) error {
	var m Message
	e := json.Unmarshal(j.Payload, &m)
	if e == nil && m.To != "" {
		e = w.Sender.Send(ctx, j.ID, m)
	}
	if e != nil {
		state := "ready"
		if j.Attempts >= 8 {
			state = "dead"
		}
		delay := time.Duration(1<<min(j.Attempts, 10)) * time.Second
		_, dbErr := w.DB.Exec(ctx, `UPDATE outbox SET state=$3,last_error=$4,next_attempt_at=clock_timestamp()+make_interval(secs=>$5),lease_until=NULL WHERE id=$1 AND lease_token=$2`, j.ID, j.Lease, state, "delivery failed; inspect SMTP connectivity", delay.Seconds())
		if dbErr != nil {
			return dbErr
		}
		return e
	}
	_, e = w.DB.Exec(ctx, `UPDATE outbox SET state='sent',delivered_at=clock_timestamp(),payload='{}',lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2`, j.ID, j.Lease)
	return e
}
func (w *Worker) Tick(ctx context.Context) error {
	if e := w.Appointments.Sweep(ctx); e != nil {
		return e
	}
	rows, e := w.DB.Query(ctx, `SELECT organization_id,id FROM slots WHERE allocation_requested AND state='available' AND starts_at>clock_timestamp() ORDER BY starts_at,id LIMIT 20`)
	if e != nil {
		return e
	}
	var items [][2]string
	for rows.Next() {
		var v [2]string
		if e = rows.Scan(&v[0], &v[1]); e != nil {
			rows.Close()
			return e
		}
		items = append(items, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range items {
		if e = w.Appointments.Allocate(ctx, v[0], v[1]); e != nil {
			return e
		}
	}
	for i := 0; i < 20; i++ {
		j, e := w.Claim(ctx)
		if e != nil {
			return e
		}
		if j == nil {
			break
		}
		if e = w.Deliver(ctx, j); e != nil {
			w.Log.Warn("outbox delivery failed", "event_id", j.ID, "attempt", j.Attempts)
		}
	}
	return nil
}
func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	cleanup := time.NewTicker(time.Hour)
	defer cleanup.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tickCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
			if e := w.Tick(tickCtx); e != nil {
				w.Log.Error("worker tick failed", "error", e.Error())
			}
			cancel()
		case <-cleanup.C:
			if _, e := w.DB.Exec(ctx, `DELETE FROM sessions WHERE expires_at<clock_timestamp(); DELETE FROM magic_tokens WHERE expires_at<clock_timestamp(); DELETE FROM rate_limits WHERE expires_at<clock_timestamp(); DELETE FROM idempotency_keys WHERE created_at<clock_timestamp()-interval '30 days'; DELETE FROM outbox WHERE (state='sent' AND delivered_at<clock_timestamp()-interval '30 days') OR (event_type='MagicLink' AND created_at<clock_timestamp()-interval '15 minutes'); DELETE FROM audit_events WHERE created_at<clock_timestamp()-interval '180 days'`); e != nil {
				w.Log.Error("retention sweep failed", "error", e.Error())
			}
		}
	}
}
