package repository

import (
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"radiation-dose-budget-control/backend/internal/model"
)

type ExposureEntryRepository struct{ db *gorm.DB }

func NewExposureEntryRepository(db *gorm.DB) *ExposureEntryRepository {
	return &ExposureEntryRepository{db: db}
}

func (repository *ExposureEntryRepository) WithDB(db *gorm.DB) *ExposureEntryRepository {
	return &ExposureEntryRepository{db: db}
}

func (repository *ExposureEntryRepository) Create(entry *model.ExposureEntry) error {
	if err := repository.db.Create(entry).Error; err != nil {
		return fmt.Errorf("create exposure entry: %w", err)
	}
	return nil
}

func (repository *ExposureEntryRepository) CreateMany(entries []model.ExposureEntry) error {
	if err := repository.db.Create(&entries).Error; err != nil {
		return fmt.Errorf("create exposure correction chain: %w", err)
	}
	return nil
}

func (repository *ExposureEntryRepository) Find(id uint) (model.ExposureEntry, error) {
	var entry model.ExposureEntry
	if err := repository.db.First(&entry, id).Error; err != nil {
		return entry, fmt.Errorf("find exposure entry: %w", err)
	}
	return entry, nil
}

func (repository *ExposureEntryRepository) FindForUpdate(id uint) (model.ExposureEntry, error) {
	var entry model.ExposureEntry
	if err := repository.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&entry, id).Error; err != nil {
		return entry, fmt.Errorf("lock exposure entry: %w", err)
	}
	return entry, nil
}

func (repository *ExposureEntryRepository) HasCorrection(id uint) (bool, error) {
	var count int64
	if err := repository.db.Model(&model.ExposureEntry{}).Where("correction_of_id = ?", id).Count(&count).Error; err != nil {
		return false, fmt.Errorf("count exposure corrections: %w", err)
	}
	return count > 0, nil
}

func (repository *ExposureEntryRepository) List(page, pageSize int, workerID uint, quality string) ([]model.ExposureEntry, int64, error) {
	query := repository.db.Model(&model.ExposureEntry{})
	if workerID > 0 {
		query = query.Where("worker_id = ?", workerID)
	}
	if quality != "" {
		query = query.Where("quality_flag = ?", quality)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count exposure entries: %w", err)
	}
	var entries []model.ExposureEntry
	if err := query.Order("occurred_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&entries).Error; err != nil {
		return nil, 0, fmt.Errorf("list exposure entries: %w", err)
	}
	return entries, total, nil
}

func (repository *ExposureEntryRepository) PeriodEntries(workerID uint, start, end time.Time) ([]model.ExposureEntry, error) {
	var entries []model.ExposureEntry
	err := repository.db.Where("worker_id = ? AND occurred_at >= ? AND occurred_at < ?", workerID, start, end).
		Order("occurred_at ASC, id ASC").Find(&entries).Error
	if err != nil {
		return nil, fmt.Errorf("list period exposure entries: %w", err)
	}
	return entries, nil
}

func (repository *ExposureEntryRepository) Verify(id uint, quality string, verifierID uint, verifiedAt time.Time, note string) error {
	result := repository.db.Model(&model.ExposureEntry{}).
		Where("id = ? AND quality_flag = ?", id, "pending").
		Updates(map[string]any{"quality_flag": quality, "verified_by": verifierID, "verified_at": verifiedAt, "note": note})
	if result.Error != nil {
		return fmt.Errorf("verify exposure entry: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("verify exposure entry: %w", ErrStateConflict)
	}
	return nil
}
