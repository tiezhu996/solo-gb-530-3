package service

import (
	"encoding/json"
	"fmt"
	"math"

	"gorm.io/gorm"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/model"
	"radiation-dose-budget-control/backend/internal/repository"
)

type AuditService struct{ repository *repository.SystemRepository }

func NewAuditService(repository *repository.SystemRepository) *AuditService {
	return &AuditService{repository: repository}
}

func (service *AuditService) Record(actor dto.Actor, requestID, action, resourceType, resourceID string, parameters, before, after any) error {
	return service.record(service.repository, actor, requestID, action, resourceType, resourceID, parameters, before, after)
}

func (service *AuditService) RecordTx(db *gorm.DB, actor dto.Actor, requestID, action, resourceType, resourceID string, parameters, before, after any) error {
	return service.record(service.repository.WithDB(db), actor, requestID, action, resourceType, resourceID, parameters, before, after)
}

func (service *AuditService) record(repository *repository.SystemRepository, actor dto.Actor, requestID, action, resourceType, resourceID string, parameters, before, after any) error {
	event := model.AuditEvent{
		Actor: actor.Username, Role: actor.Role, Action: action, ResourceType: resourceType, ResourceID: resourceID, RequestID: requestID,
		ParametersJSON: encodeSummary(parameters), BeforeSummary: encodeSummary(before), AfterSummary: encodeSummary(after),
	}
	if err := repository.CreateAudit(&event); err != nil {
		return Internal("could not record audit event", err)
	}
	return nil
}

func (service *AuditService) List(page, pageSize int, resourceType, action string) ([]dto.AuditEventResponse, dto.PageMeta, error) {
	events, total, err := service.repository.ListAudit(page, pageSize, resourceType, action)
	if err != nil {
		return nil, dto.PageMeta{}, Internal("could not list audit events", err)
	}
	responses := make([]dto.AuditEventResponse, 0, len(events))
	for _, event := range events {
		responses = append(responses, dto.AuditEventResponse{
			ID: event.ID, Actor: event.Actor, Role: event.Role, Action: event.Action, ResourceType: event.ResourceType,
			ResourceID: event.ResourceID, RequestID: event.RequestID, Parameters: decodeObject(event.ParametersJSON),
			BeforeSummary: decodeObject(event.BeforeSummary), AfterSummary: decodeObject(event.AfterSummary), CreatedAt: event.CreatedAt,
		})
	}
	return responses, pageMeta(page, pageSize, total), nil
}

func encodeSummary(value any) string {
	if value == nil {
		return "{}"
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return `{"summary":"unavailable"}`
	}
	return string(encoded)
}

func decodeObject(encoded string) map[string]interface{} {
	result := map[string]interface{}{}
	if encoded == "" {
		return result
	}
	if err := json.Unmarshal([]byte(encoded), &result); err != nil {
		return map[string]interface{}{"raw": encoded}
	}
	return result
}

func pageMeta(page, pageSize int, total int64) dto.PageMeta {
	return dto.PageMeta{Page: page, PageSize: pageSize, Total: total, TotalPages: int(math.Ceil(float64(total) / float64(pageSize)))}
}

func auditID(id uint) string { return fmt.Sprintf("%d", id) }
