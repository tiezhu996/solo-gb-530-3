package service

import (
	"fmt"
	"strings"
	"time"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/model"
	"radiation-dose-budget-control/backend/internal/repository"
)

type WorkerProfileService struct {
	workers *repository.WorkerProfileRepository
	audit   *AuditService
}

func NewWorkerProfileService(workers *repository.WorkerProfileRepository, audit *AuditService) *WorkerProfileService {
	return &WorkerProfileService{workers: workers, audit: audit}
}

func (service *WorkerProfileService) Create(request dto.CreateWorkerProfileRequest, actor dto.Actor, requestID string) (dto.WorkerProfileResponse, error) {
	if err := validateWorkerLimits(request.AdministrativeLimitMSV, request.AnnualLimitMSV); err != nil {
		return dto.WorkerProfileResponse{}, err
	}
	if !constants.IsProfileStatus(request.ProfileStatus) {
		return dto.WorkerProfileResponse{}, BadRequest("invalid_profile_status", "profile_status is not recognized")
	}
	if request.PeriodStart.After(time.Now().UTC().Add(24 * time.Hour)) {
		return dto.WorkerProfileResponse{}, BadRequest("invalid_period_start", "period_start cannot be in the future")
	}
	worker := model.WorkerProfile{
		WorkerCode: strings.ToUpper(strings.TrimSpace(request.WorkerCode)), DisplayName: strings.TrimSpace(request.DisplayName),
		AuthorizationLevel: strings.TrimSpace(request.AuthorizationLevel), AnnualLimitMSV: request.AnnualLimitMSV,
		AdministrativeLimitMSV: request.AdministrativeLimitMSV, ProfileStatus: request.ProfileStatus,
		PeriodStart: request.PeriodStart.UTC(), Version: 1,
	}
	if err := service.workers.Create(&worker); err != nil {
		if repository.IsUniqueViolation(err) {
			return dto.WorkerProfileResponse{}, Conflict("duplicate_worker_code", "worker_code already exists", err)
		}
		return dto.WorkerProfileResponse{}, Internal("could not create worker profile", err)
	}
	response, err := service.response(worker)
	if err != nil {
		return dto.WorkerProfileResponse{}, err
	}
	if err := service.audit.Record(actor, requestID, "worker.created", "worker_profile", auditID(worker.ID),
		map[string]any{"worker_code": worker.WorkerCode}, nil, workerAudit(worker)); err != nil {
		return dto.WorkerProfileResponse{}, err
	}
	return response, nil
}

func (service *WorkerProfileService) Update(id uint, request dto.UpdateWorkerProfileRequest, actor dto.Actor, requestID string) (dto.WorkerProfileResponse, error) {
	if err := validateWorkerLimits(request.AdministrativeLimitMSV, request.AnnualLimitMSV); err != nil {
		return dto.WorkerProfileResponse{}, err
	}
	if !constants.IsProfileStatus(request.ProfileStatus) {
		return dto.WorkerProfileResponse{}, BadRequest("invalid_profile_status", "profile_status is not recognized")
	}
	before, err := service.workers.Find(id)
	if err != nil {
		return dto.WorkerProfileResponse{}, MapRepositoryError("worker profile", err)
	}
	updated := before
	updated.DisplayName = strings.TrimSpace(request.DisplayName)
	updated.AuthorizationLevel = strings.TrimSpace(request.AuthorizationLevel)
	updated.AnnualLimitMSV = request.AnnualLimitMSV
	updated.AdministrativeLimitMSV = request.AdministrativeLimitMSV
	updated.ProfileStatus = request.ProfileStatus
	if err := service.workers.Update(updated, request.Version); err != nil {
		if strings.Contains(err.Error(), repository.ErrVersionConflict.Error()) {
			return dto.WorkerProfileResponse{}, Conflict("version_conflict", "worker profile changed; refresh before updating", err)
		}
		return dto.WorkerProfileResponse{}, Internal("could not update worker profile", err)
	}
	updated.Version = request.Version + 1
	updated.UpdatedAt = time.Now().UTC()
	response, err := service.response(updated)
	if err != nil {
		return dto.WorkerProfileResponse{}, err
	}
	if err := service.audit.Record(actor, requestID, "worker.updated", "worker_profile", auditID(id),
		map[string]any{"expected_version": request.Version}, workerAudit(before), workerAudit(updated)); err != nil {
		return dto.WorkerProfileResponse{}, err
	}
	return response, nil
}

func (service *WorkerProfileService) Get(id uint) (dto.WorkerProfileResponse, error) {
	worker, err := service.workers.Find(id)
	if err != nil {
		return dto.WorkerProfileResponse{}, MapRepositoryError("worker profile", err)
	}
	return service.response(worker)
}

func (service *WorkerProfileService) List(page, pageSize int, status, search string) ([]dto.WorkerProfileResponse, dto.PageMeta, error) {
	if status != "" && !constants.IsProfileStatus(status) {
		return nil, dto.PageMeta{}, BadRequest("invalid_profile_status", "profile_status filter is not recognized")
	}
	workers, total, err := service.workers.List(page, pageSize, status, strings.TrimSpace(search))
	if err != nil {
		return nil, dto.PageMeta{}, Internal("could not list worker profiles", err)
	}
	responses := make([]dto.WorkerProfileResponse, 0, len(workers))
	for _, worker := range workers {
		response, err := service.response(worker)
		if err != nil {
			return nil, dto.PageMeta{}, err
		}
		responses = append(responses, response)
	}
	return responses, pageMeta(page, pageSize, total), nil
}

func (service *WorkerProfileService) response(worker model.WorkerProfile) (dto.WorkerProfileResponse, error) {
	periodDose, err := service.workers.PeriodDose(worker.ID, worker.PeriodStart, time.Now().UTC().Add(time.Second))
	if err != nil {
		return dto.WorkerProfileResponse{}, Internal("could not calculate worker period dose", err)
	}
	return dto.WorkerProfileResponse{
		ID: worker.ID, WorkerCode: worker.WorkerCode, DisplayName: worker.DisplayName,
		AuthorizationLevel: worker.AuthorizationLevel, AnnualLimitMSV: worker.AnnualLimitMSV,
		AdministrativeLimitMSV: worker.AdministrativeLimitMSV, ProfileStatus: worker.ProfileStatus,
		PeriodStart: worker.PeriodStart, PeriodDoseMSV: clampDose(periodDose),
		RemainingAdminMSV: clampDose(worker.AdministrativeLimitMSV - periodDose),
		RemainingLegalMSV: clampDose(worker.AnnualLimitMSV - periodDose), Version: worker.Version,
		CreatedAt: worker.CreatedAt, UpdatedAt: worker.UpdatedAt,
	}, nil
}

func validateWorkerLimits(administrative, legal float64) error {
	if administrative <= 0 || legal <= 0 || administrative > legal {
		return BadRequest("invalid_limits", "administrative_limit_msv must be positive and not exceed annual_limit_msv")
	}
	return nil
}

func workerAudit(worker model.WorkerProfile) map[string]any {
	return map[string]any{
		"id": worker.ID, "worker_code": worker.WorkerCode, "authorization_level": worker.AuthorizationLevel,
		"annual_limit_msv": worker.AnnualLimitMSV, "administrative_limit_msv": worker.AdministrativeLimitMSV,
		"profile_status": worker.ProfileStatus, "period_start": worker.PeriodStart, "version": worker.Version,
	}
}

func clampDose(value float64) float64 {
	if value < 0 {
		return 0
	}
	return value
}

func parseUintFilter(value string) (uint, error) {
	if strings.TrimSpace(value) == "" {
		return 0, nil
	}
	var parsed uint
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil || parsed == 0 {
		return 0, BadRequest("invalid_filter", "numeric filter must be a positive integer")
	}
	return parsed, nil
}
