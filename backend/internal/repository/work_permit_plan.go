package repository

import (
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"radiation-dose-budget-control/backend/internal/model"
)

type WorkPermitPlanRepository struct{ db *gorm.DB }

func NewWorkPermitPlanRepository(db *gorm.DB) *WorkPermitPlanRepository {
	return &WorkPermitPlanRepository{db: db}
}

func (repository *WorkPermitPlanRepository) WithDB(db *gorm.DB) *WorkPermitPlanRepository {
	return &WorkPermitPlanRepository{db: db}
}

func (repository *WorkPermitPlanRepository) Create(plan *model.WorkPermitPlan) error {
	if err := repository.db.Create(plan).Error; err != nil {
		return fmt.Errorf("create work permit plan: %w", err)
	}
	return nil
}

func (repository *WorkPermitPlanRepository) Find(id uint) (model.WorkPermitPlan, error) {
	var plan model.WorkPermitPlan
	if err := repository.db.First(&plan, id).Error; err != nil {
		return plan, fmt.Errorf("find work permit plan: %w", err)
	}
	return plan, nil
}

func (repository *WorkPermitPlanRepository) FindForUpdate(id uint) (model.WorkPermitPlan, error) {
	var plan model.WorkPermitPlan
	if err := repository.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&plan, id).Error; err != nil {
		return plan, fmt.Errorf("lock work permit plan: %w", err)
	}
	return plan, nil
}

func (repository *WorkPermitPlanRepository) List(page, pageSize int, status string, workerID uint) ([]model.WorkPermitPlan, int64, error) {
	query := repository.db.Model(&model.WorkPermitPlan{})
	if status != "" {
		query = query.Where("permit_status = ?", status)
	}
	if workerID > 0 {
		query = query.Where("worker_id = ?", workerID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count work permit plans: %w", err)
	}
	var plans []model.WorkPermitPlan
	if err := query.Order("updated_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&plans).Error; err != nil {
		return nil, 0, fmt.Errorf("list work permit plans: %w", err)
	}
	return plans, total, nil
}

func (repository *WorkPermitPlanRepository) Update(plan model.WorkPermitPlan, expectedVersion uint) error {
	result := repository.db.Model(&model.WorkPermitPlan{}).
		Where("id = ? AND version = ? AND permit_status = ?", plan.ID, expectedVersion, "draft").
		Updates(map[string]any{
			"worker_id": plan.WorkerID, "work_area": plan.WorkArea, "task_category": plan.TaskCategory,
			"estimated_rate_msvh": plan.EstimatedRateMSVH, "planned_minutes": plan.PlannedMinutes,
			"controls_json": plan.ControlsJSON, "version": expectedVersion + 1,
		})
	if result.Error != nil {
		return fmt.Errorf("update work permit plan: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("update work permit plan: %w", ErrVersionConflict)
	}
	return nil
}

func (repository *WorkPermitPlanRepository) Transition(id, expectedVersion uint, from, to string, values map[string]any) error {
	values["permit_status"] = to
	values["version"] = expectedVersion + 1
	result := repository.db.Model(&model.WorkPermitPlan{}).
		Where("id = ? AND version = ? AND permit_status = ?", id, expectedVersion, from).
		Updates(values)
	if result.Error != nil {
		return fmt.Errorf("transition work permit plan: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("transition work permit plan: %w", ErrVersionConflict)
	}
	return nil
}
