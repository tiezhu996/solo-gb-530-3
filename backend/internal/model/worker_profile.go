package model

import "time"

type WorkerProfile struct {
	ID                     uint      `gorm:"primaryKey"`
	WorkerCode             string    `gorm:"size:40;uniqueIndex;not null"`
	DisplayName            string    `gorm:"size:120;not null"`
	AuthorizationLevel     string    `gorm:"size:60;not null"`
	AnnualLimitMSV         float64   `gorm:"not null"`
	AdministrativeLimitMSV float64   `gorm:"not null"`
	ProfileStatus          string    `gorm:"size:24;index;not null"`
	PeriodStart            time.Time `gorm:"index;not null"`
	Version                uint      `gorm:"not null;default:1"`
	CreatedAt              time.Time `gorm:"not null"`
	UpdatedAt              time.Time `gorm:"not null"`
}
