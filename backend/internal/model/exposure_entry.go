package model

import "time"

type ExposureEntry struct {
	ID             uint      `gorm:"primaryKey"`
	WorkerID       uint      `gorm:"index;not null"`
	SourceRef      string    `gorm:"size:96;uniqueIndex;not null"`
	OccurredAt     time.Time `gorm:"index;not null"`
	DoseMSV        float64   `gorm:"not null"`
	EntryType      string    `gorm:"size:24;index;not null"`
	QualityFlag    string    `gorm:"size:24;index;not null"`
	VerifiedBy     *uint     `gorm:"index"`
	VerifiedAt     *time.Time
	CorrectionOfID *uint     `gorm:"uniqueIndex"`
	Note           string    `gorm:"size:500;not null;default:''"`
	CreatedBy      uint      `gorm:"index;not null"`
	CreatedAt      time.Time `gorm:"not null"`
}
