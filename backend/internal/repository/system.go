package repository

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"radiation-dose-budget-control/backend/internal/model"
)

var (
	ErrVersionConflict = errors.New("record version or state changed")
	ErrStateConflict   = errors.New("record state changed")
)

func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") ||
		strings.Contains(message, "duplicate key") ||
		strings.Contains(message, "unique failed")
}

type SystemRepository struct{ db *gorm.DB }

func NewSystemRepository(db *gorm.DB) *SystemRepository { return &SystemRepository{db: db} }
func (repository *SystemRepository) WithDB(db *gorm.DB) *SystemRepository {
	return &SystemRepository{db: db}
}
func (repository *SystemRepository) DB() *gorm.DB { return repository.db }

func (repository *SystemRepository) FindUser(username string) (model.User, error) {
	var user model.User
	if err := repository.db.Where("username = ? AND active = ?", username, true).First(&user).Error; err != nil {
		return user, fmt.Errorf("find active user: %w", err)
	}
	return user, nil
}

func (repository *SystemRepository) FindActiveUserByID(id uint) (model.User, error) {
	var user model.User
	if err := repository.db.Where("id = ? AND active = ?", id, true).First(&user).Error; err != nil {
		return user, fmt.Errorf("find active user by id: %w", err)
	}
	return user, nil
}

func (repository *SystemRepository) CreateAudit(event *model.AuditEvent) error {
	if err := repository.db.Create(event).Error; err != nil {
		return fmt.Errorf("create audit event: %w", err)
	}
	return nil
}

func (repository *SystemRepository) ListAudit(page, pageSize int, resourceType, action string) ([]model.AuditEvent, int64, error) {
	query := repository.db.Model(&model.AuditEvent{})
	if resourceType != "" {
		query = query.Where("resource_type = ?", resourceType)
	}
	if action != "" {
		query = query.Where("action = ?", action)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count audit events: %w", err)
	}
	var events []model.AuditEvent
	if err := query.Order("created_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&events).Error; err != nil {
		return nil, 0, fmt.Errorf("list audit events: %w", err)
	}
	return events, total, nil
}
