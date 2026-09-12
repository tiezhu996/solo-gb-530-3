package model

import "time"

type WorkPermitPlan struct {
	ID                uint      `gorm:"primaryKey"`
	PlanCode          string    `gorm:"size:48;uniqueIndex;not null"`
	WorkerID          uint      `gorm:"index;not null"`
	WorkArea          string    `gorm:"size:120;not null"`
	TaskCategory      string    `gorm:"size:80;not null"`
	EstimatedRateMSVH float64   `gorm:"not null"`
	PlannedMinutes    int       `gorm:"not null"`
	ControlsJSON      string    `gorm:"type:text;not null"`
	PermitStatus      string    `gorm:"size:32;index;not null"`
	Version           uint      `gorm:"not null;default:1"`
	ReviewerID        *uint     `gorm:"index"`
	ReviewNote        string    `gorm:"type:text;not null;default:''"`
	CreatedBy         uint      `gorm:"index;not null"`
	CreatedAt         time.Time `gorm:"not null"`
	UpdatedAt         time.Time `gorm:"not null"`
	ArchivedAt        *time.Time
}
