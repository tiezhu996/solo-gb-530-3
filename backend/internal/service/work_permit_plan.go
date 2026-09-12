package service

import (
	"encoding/json"
	"strings"
	"time"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/model"
	"radiation-dose-budget-control/backend/internal/repository"
)

type WorkPermitPlanService struct {
	plans       *repository.WorkPermitPlanRepository
	workers     *repository.WorkerProfileRepository
	assessments *repository.DoseBudgetAssessmentRepository
	audit       *AuditService
}

func NewWorkPermitPlanService(
	plans *repository.WorkPermitPlanRepository,
	workers *repository.WorkerProfileRepository,
	assessments *repository.DoseBudgetAssessmentRepository,
	audit *AuditService,
) *WorkPermitPlanService {
	return &WorkPermitPlanService{plans: plans, workers: workers, assessments: assessments, audit: audit}
}

func (service *WorkPermitPlanService) Create(request dto.CreateWorkPermitPlanRequest, actor dto.Actor, requestID string) (dto.WorkPermitPlanResponse, error) {
	worker, err := service.workers.Find(request.WorkerID)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("worker profile", err)
	}
	if worker.ProfileStatus != constants.ProfileStatusActive {
		return dto.WorkPermitPlanResponse{}, Conflict("worker_not_active", "new plans require an active worker profile", nil)
	}
	controls, err := normalizeControls(request.Controls)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, err
	}
	plan := model.WorkPermitPlan{
		PlanCode: strings.ToUpper(strings.TrimSpace(request.PlanCode)), WorkerID: request.WorkerID,
		WorkArea: strings.TrimSpace(request.WorkArea), TaskCategory: strings.TrimSpace(request.TaskCategory),
		EstimatedRateMSVH: request.EstimatedRateMSVH, PlannedMinutes: request.PlannedMinutes,
		ControlsJSON: controls, PermitStatus: constants.PermitStatusDraft, Version: 1, CreatedBy: actor.ID,
	}
	if err := service.plans.Create(&plan); err != nil {
		if repository.IsUniqueViolation(err) {
			return dto.WorkPermitPlanResponse{}, Conflict("duplicate_plan_code", "plan_code already exists", err)
		}
		return dto.WorkPermitPlanResponse{}, Internal("could not create work permit plan", err)
	}
	response := planResponse(plan, worker)
	if err := service.audit.Record(actor, requestID, "plan.created", "work_permit_plan", auditID(plan.ID),
		map[string]any{"plan_code": plan.PlanCode}, nil, planAudit(plan)); err != nil {
		return dto.WorkPermitPlanResponse{}, err
	}
	return response, nil
}

func (service *WorkPermitPlanService) Update(id uint, request dto.UpdateWorkPermitPlanRequest, actor dto.Actor, requestID string) (dto.WorkPermitPlanResponse, error) {
	before, err := service.plans.Find(id)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("work permit plan", err)
	}
	if before.PermitStatus != constants.PermitStatusDraft {
		return dto.WorkPermitPlanResponse{}, Conflict("invalid_state", "only draft plans can be edited", nil)
	}
	worker, err := service.workers.Find(request.WorkerID)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("worker profile", err)
	}
	if worker.ProfileStatus != constants.ProfileStatusActive {
		return dto.WorkPermitPlanResponse{}, Conflict("worker_not_active", "plan worker must have an active profile", nil)
	}
	controls, err := normalizeControls(request.Controls)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, err
	}
	updated := before
	updated.WorkerID = request.WorkerID
	updated.WorkArea = strings.TrimSpace(request.WorkArea)
	updated.TaskCategory = strings.TrimSpace(request.TaskCategory)
	updated.EstimatedRateMSVH = request.EstimatedRateMSVH
	updated.PlannedMinutes = request.PlannedMinutes
	updated.ControlsJSON = controls
	if err := service.plans.Update(updated, request.Version); err != nil {
		if strings.Contains(err.Error(), repository.ErrVersionConflict.Error()) {
			return dto.WorkPermitPlanResponse{}, Conflict("version_conflict", "plan changed or left draft state; refresh before updating", err)
		}
		return dto.WorkPermitPlanResponse{}, Internal("could not update work permit plan", err)
	}
	updated.Version = request.Version + 1
	updated.UpdatedAt = time.Now().UTC()
	if err := service.audit.Record(actor, requestID, "plan.updated", "work_permit_plan", auditID(id),
		map[string]any{"expected_version": request.Version}, planAudit(before), planAudit(updated)); err != nil {
		return dto.WorkPermitPlanResponse{}, err
	}
	return planResponse(updated, worker), nil
}

func (service *WorkPermitPlanService) Get(id uint) (dto.WorkPermitPlanResponse, error) {
	plan, err := service.plans.Find(id)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("work permit plan", err)
	}
	worker, err := service.workers.Find(plan.WorkerID)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("plan worker", err)
	}
	return planResponse(plan, worker), nil
}

func (service *WorkPermitPlanService) List(page, pageSize int, status, workerFilter string) ([]dto.WorkPermitPlanResponse, dto.PageMeta, error) {
	if status != "" && !constants.IsPermitStatus(status) {
		return nil, dto.PageMeta{}, BadRequest("invalid_permit_status", "permit_status filter is not recognized")
	}
	workerID, err := parseUintFilter(workerFilter)
	if err != nil {
		return nil, dto.PageMeta{}, err
	}
	plans, total, err := service.plans.List(page, pageSize, status, workerID)
	if err != nil {
		return nil, dto.PageMeta{}, Internal("could not list work permit plans", err)
	}
	responses := make([]dto.WorkPermitPlanResponse, 0, len(plans))
	for _, plan := range plans {
		worker, err := service.workers.Find(plan.WorkerID)
		if err != nil {
			return nil, dto.PageMeta{}, MapRepositoryError("plan worker", err)
		}
		responses = append(responses, planResponse(plan, worker))
	}
	return responses, pageMeta(page, pageSize, total), nil
}

func (service *WorkPermitPlanService) Archive(id uint, request dto.PlanVersionRequest, actor dto.Actor, requestID string) (dto.WorkPermitPlanResponse, error) {
	before, err := service.plans.Find(id)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("work permit plan", err)
	}
	if !constants.CanTransitionPermit(before.PermitStatus, constants.PermitStatusArchived) {
		return dto.WorkPermitPlanResponse{}, Conflict("invalid_state", "only reviewed plans can be archived", nil)
	}
	now := time.Now().UTC()
	if err := service.plans.Transition(id, request.Version, before.PermitStatus, constants.PermitStatusArchived, map[string]any{"archived_at": now}); err != nil {
		return dto.WorkPermitPlanResponse{}, Conflict("version_conflict", "plan changed before archive", err)
	}
	after := before
	after.PermitStatus = constants.PermitStatusArchived
	after.Version = request.Version + 1
	after.ArchivedAt = &now
	if err := service.audit.Record(actor, requestID, "plan.archived", "work_permit_plan", auditID(id),
		map[string]any{"expected_version": request.Version}, planAudit(before), planAudit(after)); err != nil {
		return dto.WorkPermitPlanResponse{}, err
	}
	worker, err := service.workers.Find(after.WorkerID)
	if err != nil {
		return dto.WorkPermitPlanResponse{}, MapRepositoryError("plan worker", err)
	}
	return planResponse(after, worker), nil
}

func normalizeControls(values []string) (string, error) {
	normalized := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[strings.ToLower(value)] {
			continue
		}
		seen[strings.ToLower(value)] = true
		normalized = append(normalized, value)
	}
	if len(normalized) == 0 {
		return "", BadRequest("controls_required", "at least one concrete exposure control is required")
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "", Internal("could not encode plan controls", err)
	}
	return string(encoded), nil
}

func planResponse(plan model.WorkPermitPlan, worker model.WorkerProfile) dto.WorkPermitPlanResponse {
	controls := []string{}
	_ = json.Unmarshal([]byte(plan.ControlsJSON), &controls)
	return dto.WorkPermitPlanResponse{
		ID: plan.ID, PlanCode: plan.PlanCode, WorkerID: plan.WorkerID, WorkerCode: worker.WorkerCode,
		WorkerName: worker.DisplayName, WorkArea: plan.WorkArea, TaskCategory: plan.TaskCategory,
		EstimatedRateMSVH: plan.EstimatedRateMSVH, PlannedMinutes: plan.PlannedMinutes,
		ProjectedDoseMSV: plan.EstimatedRateMSVH * float64(plan.PlannedMinutes) / 60,
		Controls:         controls, PermitStatus: plan.PermitStatus, Version: plan.Version,
		ReviewerID: plan.ReviewerID, ReviewNote: plan.ReviewNote, CreatedAt: plan.CreatedAt,
		UpdatedAt: plan.UpdatedAt, ArchivedAt: plan.ArchivedAt,
	}
}

func planAudit(plan model.WorkPermitPlan) map[string]any {
	return map[string]any{
		"id": plan.ID, "plan_code": plan.PlanCode, "worker_id": plan.WorkerID, "work_area": plan.WorkArea,
		"task_category": plan.TaskCategory, "estimated_rate_msvh": plan.EstimatedRateMSVH,
		"planned_minutes": plan.PlannedMinutes, "controls": plan.ControlsJSON, "permit_status": plan.PermitStatus,
		"version": plan.Version, "reviewer_id": plan.ReviewerID,
	}
}
