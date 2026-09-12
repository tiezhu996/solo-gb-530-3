package repository

import (
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"radiation-dose-budget-control/backend/internal/model"
)

type WorkerProfileRepository struct{ db *gorm.DB }

func NewWorkerProfileRepository(db *gorm.DB) *WorkerProfileRepository {
	return &WorkerProfileRepository{db: db}
}

func (repository *WorkerProfileRepository) WithDB(db *gorm.DB) *WorkerProfileRepository {
	return &WorkerProfileRepository{db: db}
}

func (repository *WorkerProfileRepository) Create(worker *model.WorkerProfile) error {
	if err := repository.db.Create(worker).Error; err != nil {
		return fmt.Errorf("create worker profile: %w", err)
	}
	return nil
}

func (repository *WorkerProfileRepository) Find(id uint) (model.WorkerProfile, error) {
	var worker model.WorkerProfile
	if err := repository.db.First(&worker, id).Error; err != nil {
		return worker, fmt.Errorf("find worker profile: %w", err)
	}
	return worker, nil
}

func (repository *WorkerProfileRepository) FindForUpdate(id uint) (model.WorkerProfile, error) {
	var worker model.WorkerProfile
	if err := repository.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&worker, id).Error; err != nil {
		return worker, fmt.Errorf("lock worker profile: %w", err)
	}
	return worker, nil
}

func (repository *WorkerProfileRepository) List(page, pageSize int, status, search string) ([]model.WorkerProfile, int64, error) {
	query := repository.db.Model(&model.WorkerProfile{})
	if status != "" {
		query = query.Where("profile_status = ?", status)
	}
	if search != "" {
		pattern := "%" + search + "%"
		query = query.Where("worker_code LIKE ? OR display_name LIKE ?", pattern, pattern)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count worker profiles: %w", err)
	}
	var workers []model.WorkerProfile
	if err := query.Order("worker_code ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&workers).Error; err != nil {
		return nil, 0, fmt.Errorf("list worker profiles: %w", err)
	}
	return workers, total, nil
}

func (repository *WorkerProfileRepository) Update(worker model.WorkerProfile, expectedVersion uint) error {
	result := repository.db.Model(&model.WorkerProfile{}).
		Where("id = ? AND version = ?", worker.ID, expectedVersion).
		Updates(map[string]any{
			"display_name": worker.DisplayName, "authorization_level": worker.AuthorizationLevel,
			"annual_limit_msv": worker.AnnualLimitMSV, "administrative_limit_msv": worker.AdministrativeLimitMSV,
			"profile_status": worker.ProfileStatus, "version": expectedVersion + 1,
		})
	if result.Error != nil {
		return fmt.Errorf("update worker profile: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("update worker profile: %w", ErrVersionConflict)
	}
	return nil
}

func (repository *WorkerProfileRepository) PeriodDose(workerID uint, start, end time.Time) (float64, error) {
	var total float64
	err := repository.db.Model(&model.ExposureEntry{}).
		Where("worker_id = ? AND quality_flag = ? AND occurred_at >= ? AND occurred_at < ?", workerID, "verified", start, end).
		Select("COALESCE(SUM(dose_msv), 0)").Scan(&total).Error
	if err != nil {
		return 0, fmt.Errorf("sum worker period dose: %w", err)
	}
	return total, nil
}
