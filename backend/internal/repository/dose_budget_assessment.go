package repository

import (
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"radiation-dose-budget-control/backend/internal/model"
)

type DoseBudgetAssessmentRepository struct{ db *gorm.DB }

func NewDoseBudgetAssessmentRepository(db *gorm.DB) *DoseBudgetAssessmentRepository {
	return &DoseBudgetAssessmentRepository{db: db}
}

func (repository *DoseBudgetAssessmentRepository) WithDB(db *gorm.DB) *DoseBudgetAssessmentRepository {
	return &DoseBudgetAssessmentRepository{db: db}
}

func (repository *DoseBudgetAssessmentRepository) Create(assessment *model.DoseBudgetAssessment) error {
	if err := repository.db.Create(assessment).Error; err != nil {
		return fmt.Errorf("create dose budget assessment: %w", err)
	}
	return nil
}

func (repository *DoseBudgetAssessmentRepository) Find(id uint) (model.DoseBudgetAssessment, error) {
	var assessment model.DoseBudgetAssessment
	if err := repository.db.First(&assessment, id).Error; err != nil {
		return assessment, fmt.Errorf("find dose budget assessment: %w", err)
	}
	return assessment, nil
}

func (repository *DoseBudgetAssessmentRepository) FindForUpdate(id uint) (model.DoseBudgetAssessment, error) {
	var assessment model.DoseBudgetAssessment
	if err := repository.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&assessment, id).Error; err != nil {
		return assessment, fmt.Errorf("lock dose budget assessment: %w", err)
	}
	return assessment, nil
}

func (repository *DoseBudgetAssessmentRepository) List(page, pageSize int, workerID, planID uint, status string) ([]model.DoseBudgetAssessment, int64, error) {
	query := repository.db.Model(&model.DoseBudgetAssessment{})
	if workerID > 0 {
		query = query.Where("worker_id = ?", workerID)
	}
	if planID > 0 {
		query = query.Where("plan_id = ?", planID)
	}
	if status != "" {
		query = query.Where("assessment_status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count dose budget assessments: %w", err)
	}
	var assessments []model.DoseBudgetAssessment
	if err := query.Order("created_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assessments).Error; err != nil {
		return nil, 0, fmt.Errorf("list dose budget assessments: %w", err)
	}
	return assessments, total, nil
}

func (repository *DoseBudgetAssessmentRepository) LatestForPlan(planID uint) (model.DoseBudgetAssessment, error) {
	var assessment model.DoseBudgetAssessment
	err := repository.db.Where("plan_id = ?", planID).Order("created_at DESC, id DESC").First(&assessment).Error
	if err != nil {
		return assessment, fmt.Errorf("find latest plan assessment: %w", err)
	}
	return assessment, nil
}

func (repository *DoseBudgetAssessmentRepository) Review(id uint, from, to string, reviewerID uint, reviewedAt time.Time, note string) error {
	result := repository.db.Model(&model.DoseBudgetAssessment{}).
		Where("id = ? AND assessment_status = ?", id, from).
		Updates(map[string]any{
			"assessment_status": to, "reviewed_by": reviewerID, "reviewed_at": reviewedAt, "review_note": note,
		})
	if result.Error != nil {
		return fmt.Errorf("review dose budget assessment: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("review dose budget assessment: %w", ErrStateConflict)
	}
	return nil
}

func (repository *DoseBudgetAssessmentRepository) TransitionStatus(id uint, from, to string) error {
	result := repository.db.Model(&model.DoseBudgetAssessment{}).
		Where("id = ? AND assessment_status = ?", id, from).
		Update("assessment_status", to)
	if result.Error != nil {
		return fmt.Errorf("transition dose budget assessment: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("transition dose budget assessment: %w", ErrStateConflict)
	}
	return nil
}
