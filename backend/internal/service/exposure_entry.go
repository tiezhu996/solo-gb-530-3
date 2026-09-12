package service

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/model"
	"radiation-dose-budget-control/backend/internal/repository"
)

type ExposureEntryService struct {
	db      *gorm.DB
	entries *repository.ExposureEntryRepository
	workers *repository.WorkerProfileRepository
	audit   *AuditService
}

func NewExposureEntryService(
	db *gorm.DB,
	entries *repository.ExposureEntryRepository,
	workers *repository.WorkerProfileRepository,
	audit *AuditService,
) *ExposureEntryService {
	return &ExposureEntryService{db: db, entries: entries, workers: workers, audit: audit}
}

func (service *ExposureEntryService) Create(request dto.CreateExposureEntryRequest, actor dto.Actor, requestID string) (dto.ExposureEntryResponse, error) {
	worker, err := service.workers.Find(request.WorkerID)
	if err != nil {
		return dto.ExposureEntryResponse{}, MapRepositoryError("worker profile", err)
	}
	if request.OccurredAt.After(time.Now().UTC().Add(5 * time.Minute)) {
		return dto.ExposureEntryResponse{}, BadRequest("invalid_occurred_at", "occurred_at cannot be in the future")
	}
	entry := model.ExposureEntry{
		WorkerID: request.WorkerID, SourceRef: strings.ToUpper(strings.TrimSpace(request.SourceRef)),
		OccurredAt: request.OccurredAt.UTC(), DoseMSV: request.DoseMSV, EntryType: constants.EntryTypeConfirmed,
		QualityFlag: constants.QualityFlagPending, Note: strings.TrimSpace(request.Note), CreatedBy: actor.ID,
	}
	if err := service.entries.Create(&entry); err != nil {
		if repository.IsUniqueViolation(err) {
			return dto.ExposureEntryResponse{}, Conflict("duplicate_source_ref", "source_ref already exists; records must not be overwritten", err)
		}
		return dto.ExposureEntryResponse{}, Internal("could not create exposure entry", err)
	}
	if err := service.audit.Record(actor, requestID, "exposure.created", "exposure_entry", auditID(entry.ID),
		map[string]any{"source_ref": entry.SourceRef}, nil, exposureAudit(entry)); err != nil {
		return dto.ExposureEntryResponse{}, err
	}
	return exposureResponse(entry, worker), nil
}

func (service *ExposureEntryService) Verify(id uint, request dto.VerifyExposureEntryRequest, actor dto.Actor, requestID string) (dto.ExposureEntryResponse, error) {
	before, err := service.entries.Find(id)
	if err != nil {
		return dto.ExposureEntryResponse{}, MapRepositoryError("exposure entry", err)
	}
	if before.QualityFlag != constants.QualityFlagPending {
		return dto.ExposureEntryResponse{}, Conflict("quality_state_conflict", "only pending exposure entries can be verified or rejected", nil)
	}
	now := time.Now().UTC()
	note := before.Note
	if strings.TrimSpace(request.Note) != "" {
		note = strings.TrimSpace(request.Note)
	}
	if err := service.entries.Verify(id, request.QualityFlag, actor.ID, now, note); err != nil {
		return dto.ExposureEntryResponse{}, Conflict("quality_state_conflict", "entry quality changed before review", err)
	}
	after := before
	after.QualityFlag = request.QualityFlag
	after.VerifiedBy = &actor.ID
	after.VerifiedAt = &now
	after.Note = note
	if err := service.audit.Record(actor, requestID, "exposure.quality_reviewed", "exposure_entry", auditID(id),
		map[string]any{"quality_flag": request.QualityFlag, "note_length": len(note)}, exposureAudit(before), exposureAudit(after)); err != nil {
		return dto.ExposureEntryResponse{}, err
	}
	worker, err := service.workers.Find(after.WorkerID)
	if err != nil {
		return dto.ExposureEntryResponse{}, MapRepositoryError("entry worker", err)
	}
	return exposureResponse(after, worker), nil
}

func (service *ExposureEntryService) Correct(id uint, request dto.CorrectExposureEntryRequest, actor dto.Actor, requestID string) (dto.CorrectionChainResponse, error) {
	var response dto.CorrectionChainResponse
	err := service.db.Transaction(func(tx *gorm.DB) error {
		entries := service.entries.WithDB(tx)
		workers := service.workers.WithDB(tx)
		original, err := entries.FindForUpdate(id)
		if err != nil {
			return MapRepositoryError("exposure entry", err)
		}
		if original.QualityFlag != constants.QualityFlagVerified {
			return Conflict("correction_requires_verified", "only verified exposure entries can be corrected", nil)
		}
		hasCorrection, err := entries.HasCorrection(original.ID)
		if err != nil {
			return Internal("could not inspect correction chain", err)
		}
		if hasCorrection {
			return Conflict("correction_chain_conflict", "entry already has an immutable correction successor", nil)
		}
		if request.OccurredAt.After(time.Now().UTC().Add(5 * time.Minute)) {
			return BadRequest("invalid_occurred_at", "replacement occurred_at cannot be in the future")
		}
		worker, err := workers.Find(original.WorkerID)
		if err != nil {
			return MapRepositoryError("entry worker", err)
		}
		now := time.Now().UTC()
		newSource := strings.ToUpper(strings.TrimSpace(request.SourceRef))
		reversalSource := fmt.Sprintf("REV-%d-%s", original.ID, newSource)
		if len(reversalSource) > 96 {
			reversalSource = reversalSource[:96]
		}
		reversal := model.ExposureEntry{
			WorkerID: original.WorkerID, SourceRef: reversalSource, OccurredAt: original.OccurredAt,
			DoseMSV: -original.DoseMSV, EntryType: constants.EntryTypeReversal,
			QualityFlag: constants.QualityFlagVerified, VerifiedBy: &actor.ID, VerifiedAt: &now,
			CorrectionOfID: &original.ID, Note: "Immutable reversal: " + strings.TrimSpace(request.Note), CreatedBy: actor.ID,
		}
		if err := entries.Create(&reversal); err != nil {
			if repository.IsUniqueViolation(err) {
				return Conflict("correction_chain_conflict", "correction source or chain successor already exists", err)
			}
			return Internal("could not create reversal entry", err)
		}
		replacement := model.ExposureEntry{
			WorkerID: original.WorkerID, SourceRef: newSource, OccurredAt: request.OccurredAt.UTC(),
			DoseMSV: request.ReplacementMSV, EntryType: constants.EntryTypeReplacement,
			QualityFlag: constants.QualityFlagVerified, VerifiedBy: &actor.ID, VerifiedAt: &now,
			CorrectionOfID: &reversal.ID, Note: "Immutable replacement: " + strings.TrimSpace(request.Note), CreatedBy: actor.ID,
		}
		if err := entries.Create(&replacement); err != nil {
			if repository.IsUniqueViolation(err) {
				return Conflict("duplicate_source_ref", "replacement source_ref or chain successor already exists", err)
			}
			return Internal("could not create replacement entry", err)
		}
		if err := service.audit.RecordTx(tx, actor, requestID, "exposure.corrected", "exposure_entry", auditID(original.ID),
			map[string]any{"reversal_id": reversal.ID, "replacement_id": replacement.ID, "replacement_source_ref": replacement.SourceRef},
			exposureAudit(original), map[string]any{"original_preserved": true, "net_replacement_msv": replacement.DoseMSV}); err != nil {
			return err
		}
		response = dto.CorrectionChainResponse{
			Original: exposureResponse(original, worker), Reversal: exposureResponse(reversal, worker),
			Replacement: exposureResponse(replacement, worker), NetDoseMSV: replacement.DoseMSV,
		}
		return nil
	})
	if err != nil {
		return dto.CorrectionChainResponse{}, err
	}
	return response, nil
}

func (service *ExposureEntryService) Get(id uint) (dto.ExposureEntryResponse, error) {
	entry, err := service.entries.Find(id)
	if err != nil {
		return dto.ExposureEntryResponse{}, MapRepositoryError("exposure entry", err)
	}
	worker, err := service.workers.Find(entry.WorkerID)
	if err != nil {
		return dto.ExposureEntryResponse{}, MapRepositoryError("entry worker", err)
	}
	return exposureResponse(entry, worker), nil
}

func (service *ExposureEntryService) List(page, pageSize int, workerFilter, quality string) ([]dto.ExposureEntryResponse, dto.PageMeta, error) {
	workerID, err := parseUintFilter(workerFilter)
	if err != nil {
		return nil, dto.PageMeta{}, err
	}
	if quality != "" && !constants.IsQualityFlag(quality) {
		return nil, dto.PageMeta{}, BadRequest("invalid_quality_flag", "quality_flag filter is not recognized")
	}
	entries, total, err := service.entries.List(page, pageSize, workerID, quality)
	if err != nil {
		return nil, dto.PageMeta{}, Internal("could not list exposure entries", err)
	}
	responses := make([]dto.ExposureEntryResponse, 0, len(entries))
	for _, entry := range entries {
		worker, err := service.workers.Find(entry.WorkerID)
		if err != nil {
			return nil, dto.PageMeta{}, MapRepositoryError("entry worker", err)
		}
		responses = append(responses, exposureResponse(entry, worker))
	}
	return responses, pageMeta(page, pageSize, total), nil
}

func exposureResponse(entry model.ExposureEntry, worker model.WorkerProfile) dto.ExposureEntryResponse {
	return dto.ExposureEntryResponse{
		ID: entry.ID, WorkerID: entry.WorkerID, WorkerCode: worker.WorkerCode, WorkerName: worker.DisplayName,
		SourceRef: entry.SourceRef, OccurredAt: entry.OccurredAt, DoseMSV: entry.DoseMSV,
		EntryType: entry.EntryType, QualityFlag: entry.QualityFlag, VerifiedBy: entry.VerifiedBy,
		VerifiedAt: entry.VerifiedAt, CorrectionOfID: entry.CorrectionOfID, Note: entry.Note, CreatedAt: entry.CreatedAt,
	}
}

func exposureAudit(entry model.ExposureEntry) map[string]any {
	return map[string]any{
		"id": entry.ID, "worker_id": entry.WorkerID, "source_ref": entry.SourceRef,
		"occurred_at": entry.OccurredAt, "dose_msv": entry.DoseMSV, "entry_type": entry.EntryType,
		"quality_flag": entry.QualityFlag, "verified_by": entry.VerifiedBy, "correction_of_id": entry.CorrectionOfID,
	}
}
