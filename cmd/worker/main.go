package main

import (
	"context"
	"github.com/REinstall-SyS/WaitlistFair/internal/appointments"
	"github.com/REinstall-SyS/WaitlistFair/internal/config"
	"github.com/REinstall-SyS/WaitlistFair/internal/notifications"
	"github.com/REinstall-SyS/WaitlistFair/internal/persistence"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	c, e := config.Load()
	if e != nil {
		log.Error("configuration", "error", e.Error())
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, e := persistence.Open(ctx, c.DatabaseURL)
	if e != nil {
		log.Error("database", "error", e.Error())
		os.Exit(1)
	}
	defer db.Close()
	worker := &notifications.Worker{DB: db, Appointments: &appointments.Service{DB: db, AppURL: c.AppURL}, Sender: notifications.SMTP{Config: c}, Log: log}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		check, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if db.Ping(check) != nil {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	})
	server := &http.Server{Addr: ":8081", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if e := server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			log.Error("worker health server", "error", e.Error())
			stop()
		}
	}()
	worker.Run(ctx)
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
