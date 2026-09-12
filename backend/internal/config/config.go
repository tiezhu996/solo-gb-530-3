package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/model"
)

type ThresholdConfig struct {
	DefaultAnnualLimitMSV float64
	DefaultAdminLimitMSV  float64
	NearLegalRatio        float64
	Version               string
}

type Config struct {
	Port               string
	DBDriver           string
	DBDSN              string
	DBAutoMigrate      bool
	JWTSecret          string
	JWTTTL             time.Duration
	CORSOrigin         string
	LogLevel           string
	RateLimitPerMinute int
	DefaultPeriodDays  int
	Thresholds         ThresholdConfig
}

func Load() (Config, error) {
	cfg := Config{
		Port:               envString("PORT", "8080"),
		DBDriver:           envString("DB_DRIVER", "postgres"),
		DBDSN:              envString("DB_DSN", "host=localhost user=doseplanner password=dose_local_530 dbname=dose_budget port=57530 sslmode=disable TimeZone=UTC"),
		DBAutoMigrate:      envBool("DB_AUTO_MIGRATE", true),
		JWTSecret:          envString("JWT_SECRET", ""),
		JWTTTL:             time.Duration(envInt("JWT_TTL_MINUTES", 480)) * time.Minute,
		CORSOrigin:         envString("CORS_ORIGIN", "http://localhost:18530"),
		LogLevel:           envString("LOG_LEVEL", "info"),
		RateLimitPerMinute: envInt("RATE_LIMIT_PER_MINUTE", 240),
		DefaultPeriodDays:  envInt("DEFAULT_PERIOD_DAYS", 365),
		Thresholds: ThresholdConfig{
			DefaultAnnualLimitMSV: envFloat("DEFAULT_ANNUAL_LIMIT_MSV", 20),
			DefaultAdminLimitMSV:  envFloat("DEFAULT_ADMIN_LIMIT_MSV", 12),
			NearLegalRatio:        envFloat("NEAR_LEGAL_RATIO", 0.9),
			Version:               envString("THRESHOLD_VERSION", "ALARA-2026.1"),
		},
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, errors.New("JWT_SECRET must contain at least 32 bytes")
	}
	if cfg.RateLimitPerMinute < 20 {
		return Config{}, errors.New("RATE_LIMIT_PER_MINUTE must be at least 20")
	}
	if cfg.DefaultPeriodDays < 1 || cfg.DefaultPeriodDays > 370 {
		return Config{}, errors.New("DEFAULT_PERIOD_DAYS must be from 1 to 370")
	}
	if cfg.Thresholds.DefaultAdminLimitMSV <= 0 || cfg.Thresholds.DefaultAnnualLimitMSV <= 0 ||
		cfg.Thresholds.DefaultAdminLimitMSV > cfg.Thresholds.DefaultAnnualLimitMSV {
		return Config{}, errors.New("configured dose thresholds are invalid")
	}
	if cfg.Thresholds.NearLegalRatio < 0.5 || cfg.Thresholds.NearLegalRatio >= 1 {
		return Config{}, errors.New("NEAR_LEGAL_RATIO must be in [0.5, 1)")
	}
	return cfg, nil
}

func OpenDatabase(cfg Config) (*gorm.DB, error) {
	var dialector gorm.Dialector
	switch cfg.DBDriver {
	case "postgres":
		dialector = postgres.Open(cfg.DBDSN)
	case "sqlite":
		dialector = sqlite.Open(cfg.DBDSN)
	default:
		return nil, fmt.Errorf("unsupported DB_DRIVER %q", cfg.DBDriver)
	}
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if cfg.DBAutoMigrate {
		if err := db.AutoMigrate(
			&model.User{}, &model.WorkerProfile{}, &model.WorkPermitPlan{},
			&model.ExposureEntry{}, &model.DoseBudgetAssessment{}, &model.AuditEvent{},
		); err != nil {
			return nil, fmt.Errorf("migrate database: %w", err)
		}
	}
	if err := seed(db, cfg); err != nil {
		return nil, fmt.Errorf("seed database: %w", err)
	}
	return db, nil
}

func seed(db *gorm.DB, cfg Config) error {
	for _, account := range []struct{ username, password, role string }{
		{"planner", "Planner#530", constants.RolePlanner},
		{"rpo", "RPO#Review530", constants.RoleRPOReviewer},
		{"admin", "Admin#530", constants.RoleAdmin},
	} {
		var count int64
		if err := db.Model(&model.User{}).Where("username = ?", account.username).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			hash, err := bcrypt.GenerateFromPassword([]byte(account.password), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			if err := db.Create(&model.User{Username: account.username, PasswordHash: string(hash), Role: account.role, Active: true}).Error; err != nil {
				return err
			}
		}
	}
	var workerCount int64
	if err := db.Model(&model.WorkerProfile{}).Count(&workerCount).Error; err != nil {
		return err
	}
	if workerCount > 0 {
		return nil
	}
	var planner model.User
	if err := db.Where("username = ?", "planner").First(&planner).Error; err != nil {
		return err
	}
	var rpo model.User
	if err := db.Where("username = ?", "rpo").First(&rpo).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	periodStart := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	workers := []model.WorkerProfile{
		{WorkerCode: "RP-1042", DisplayName: "Mara Chen", AuthorizationLevel: "Controlled area L2", AnnualLimitMSV: 20, AdministrativeLimitMSV: 12, ProfileStatus: constants.ProfileStatusActive, PeriodStart: periodStart, Version: 1},
		{WorkerCode: "RP-1178", DisplayName: "Noah Patel", AuthorizationLevel: "Hot-cell L3", AnnualLimitMSV: 20, AdministrativeLimitMSV: 10, ProfileStatus: constants.ProfileStatusActive, PeriodStart: periodStart, Version: 1},
		{WorkerCode: "RP-0926", DisplayName: "Elena Rossi", AuthorizationLevel: "Supervised area L1", AnnualLimitMSV: 20, AdministrativeLimitMSV: 8, ProfileStatus: constants.ProfileStatusSuspended, PeriodStart: periodStart, Version: 1},
	}
	if err := db.Create(&workers).Error; err != nil {
		return err
	}
	controls := func(values ...string) string {
		encoded, _ := json.Marshal(values)
		return string(encoded)
	}
	plans := []model.WorkPermitPlan{
		{PlanCode: "ALARA-530-A", WorkerID: workers[0].ID, WorkArea: "Turbine annex R-12", TaskCategory: "Shield survey", EstimatedRateMSVH: 0.42, PlannedMinutes: 45, ControlsJSON: controls("temporary shielding", "remote reading", "two-person time check"), PermitStatus: constants.PermitStatusDraft, Version: 1, CreatedBy: planner.ID},
		{PlanCode: "ALARA-530-B", WorkerID: workers[1].ID, WorkArea: "Hot-cell transfer bay", TaskCategory: "Manipulator inspection", EstimatedRateMSVH: 2.8, PlannedMinutes: 90, ControlsJSON: controls("staged tools", "continuous RPO observation", "abort point at 45 minutes"), PermitStatus: constants.PermitStatusDraft, Version: 1, CreatedBy: planner.ID},
		{PlanCode: "ALARA-530-C", WorkerID: workers[0].ID, WorkArea: "Waste assay corridor", TaskCategory: "Container verification", EstimatedRateMSVH: 0.18, PlannedMinutes: 60, ControlsJSON: controls("distance markers", "pre-job briefing"), PermitStatus: constants.PermitStatusDraft, Version: 1, CreatedBy: planner.ID},
	}
	if err := db.Create(&plans).Error; err != nil {
		return err
	}
	verifiedAt := now.Add(-20 * time.Hour)
	original := model.ExposureEntry{WorkerID: workers[0].ID, SourceRef: "TLD-530-0001", OccurredAt: now.Add(-45 * 24 * time.Hour), DoseMSV: 2.35, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified, VerifiedBy: &rpo.ID, VerifiedAt: &verifiedAt, Note: "Validated quarterly badge result", CreatedBy: planner.ID}
	if err := db.Create(&original).Error; err != nil {
		return err
	}
	reversal := model.ExposureEntry{WorkerID: workers[0].ID, SourceRef: "TLD-530-0001-REV", OccurredAt: original.OccurredAt, DoseMSV: -2.35, EntryType: constants.EntryTypeReversal, QualityFlag: constants.QualityFlagVerified, VerifiedBy: &rpo.ID, VerifiedAt: &verifiedAt, CorrectionOfID: &original.ID, Note: "Immutable reversal after laboratory correction", CreatedBy: planner.ID}
	if err := db.Create(&reversal).Error; err != nil {
		return err
	}
	replacement := model.ExposureEntry{WorkerID: workers[0].ID, SourceRef: "TLD-530-0001-C1", OccurredAt: original.OccurredAt, DoseMSV: 1.95, EntryType: constants.EntryTypeReplacement, QualityFlag: constants.QualityFlagVerified, VerifiedBy: &rpo.ID, VerifiedAt: &verifiedAt, CorrectionOfID: &reversal.ID, Note: "Laboratory-confirmed replacement value", CreatedBy: planner.ID}
	entries := []model.ExposureEntry{
		replacement,
		{WorkerID: workers[0].ID, SourceRef: "EDE-530-014", OccurredAt: now.Add(-18 * 24 * time.Hour), DoseMSV: 3.2, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified, VerifiedBy: &rpo.ID, VerifiedAt: &verifiedAt, Note: "Confirmed task dose", CreatedBy: planner.ID},
		{WorkerID: workers[1].ID, SourceRef: "TLD-530-0048", OccurredAt: now.Add(-30 * 24 * time.Hour), DoseMSV: 6.7, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified, VerifiedBy: &rpo.ID, VerifiedAt: &verifiedAt, Note: "Validated badge result", CreatedBy: planner.ID},
		{WorkerID: workers[1].ID, SourceRef: "SURVEY-530-PENDING", OccurredAt: now.Add(-2 * 24 * time.Hour), DoseMSV: 0.8, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagPending, Note: "Awaiting independent verification", CreatedBy: planner.ID},
	}
	if err := db.Create(&entries).Error; err != nil {
		return err
	}
	_ = cfg
	return nil
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

func envFloat(key string, fallback float64) float64 {
	value, err := strconv.ParseFloat(os.Getenv(key), 64)
	if err != nil {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
