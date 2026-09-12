package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"radiation-dose-budget-control/backend/internal/config"
	"radiation-dose-budget-control/backend/internal/router"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	cfg, err := config.Load()
	if err != nil {
		slog.Error("configuration failed", "error", err)
		os.Exit(1)
	}
	db, err := config.OpenDatabase(cfg)
	if err != nil {
		slog.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	server := &http.Server{Addr: ":" + cfg.Port, Handler: router.New(db, cfg), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	errors := make(chan error, 1)
	go func() {
		slog.Info("server started", "port", cfg.Port, "db_driver", cfg.DBDriver)
		errors <- server.ListenAndServe()
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signal := <-signals:
		slog.Info("shutdown requested", "signal", signal.String())
	case err := <-errors:
		if err != nil && err != http.ErrServerClosed {
			slog.Error("server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
	}
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
	slog.Info("server stopped")
}
