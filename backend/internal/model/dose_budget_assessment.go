package model

import "time"

type DoseBudgetAssessment struct {
	ID                uint      `gorm:"primaryKey"`
	WorkerID          uint      `gorm:"index;not null"`
	PlanID            uint      `gorm:"index;not null"`
	AssessmentStatus  string    `gorm:"size:24;index;not null"`
	InputSnapshotJSON string    `gorm:"type:text;not null"`
	PeriodDoseMSV     float64   `gorm:"not null"`
	ProjectedDoseMSV  float64   `gorm:"not null"`
	RemainingAdminMSV float64   `gorm:"not null"`
	RemainingLegalMSV float64   `gorm:"not null"`
	RiskBand          string    `gorm:"size:24;index;not null"`
	EvidenceJSON      string    `gorm:"type:text;not null"`
	ThresholdVersion  string    `gorm:"size:40;not null"`
	PlanVersion       uint      `gorm:"not null"`
	WorkerVersion     uint      `gorm:"not null"`
	CreatedBy         uint      `gorm:"index;not null"`
	CreatedAt         time.Time `gorm:"index;not null"`
	ReviewedBy        *uint     `gorm:"index"`
	ReviewedAt        *time.Time
	ReviewNote        string `gorm:"type:text;not null;default:''"`
}
