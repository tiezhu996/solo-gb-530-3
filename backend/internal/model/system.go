package model

import "time"

type User struct {
	ID           uint      `gorm:"primaryKey"`
	Username     string    `gorm:"size:80;uniqueIndex;not null"`
	PasswordHash string    `gorm:"size:120;not null"`
	Role         string    `gorm:"size:24;index;not null"`
	Active       bool      `gorm:"not null;default:true"`
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`
}

type AuditEvent struct {
	ID             uint      `gorm:"primaryKey"`
	Actor          string    `gorm:"size:80;index;not null"`
	Role           string    `gorm:"size:24;not null"`
	Action         string    `gorm:"size:80;index;not null"`
	ResourceType   string    `gorm:"size:48;index;not null"`
	ResourceID     string    `gorm:"size:64;index;not null"`
	RequestID      string    `gorm:"size:80;index;not null"`
	ParametersJSON string    `gorm:"type:text;not null"`
	BeforeSummary  string    `gorm:"type:text;not null"`
	AfterSummary   string    `gorm:"type:text;not null"`
	CreatedAt      time.Time `gorm:"index;not null"`
}
