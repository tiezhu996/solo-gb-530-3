package dosebudget

import (
	"fmt"
	"math"
	"sort"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/model"
)

type PeriodSummary struct {
	DoseMSV             float64
	VerifiedEntryCount  int
	ExcludedEntryCount  int
	CorrectedChainCount int
	IncludedEntryIDs    []uint
	ExcludedEntryIDs    []uint
}

func SummarizeEntries(entries []model.ExposureEntry) (PeriodSummary, error) {
	result := PeriodSummary{IncludedEntryIDs: []uint{}, ExcludedEntryIDs: []uint{}}
	byID := make(map[uint]model.ExposureEntry, len(entries))
	sources := make(map[string]uint, len(entries))
	for _, entry := range entries {
		if previous, exists := sources[entry.SourceRef]; exists {
			return result, fmt.Errorf("%w: %s used by %d and %d", ErrDuplicateSource, entry.SourceRef, previous, entry.ID)
		}
		sources[entry.SourceRef] = entry.ID
		byID[entry.ID] = entry
	}
	for _, entry := range entries {
		if math.IsNaN(entry.DoseMSV) || math.IsInf(entry.DoseMSV, 0) {
			return result, fmt.Errorf("%w: entry %d has non-finite dose", ErrInvalidDoseInput, entry.ID)
		}
		if err := validateChain(entry, byID); err != nil {
			return result, err
		}
		if entry.QualityFlag != constants.QualityFlagVerified {
			result.ExcludedEntryCount++
			result.ExcludedEntryIDs = append(result.ExcludedEntryIDs, entry.ID)
			continue
		}
		if entry.EntryType == constants.EntryTypeConfirmed && entry.DoseMSV < 0 {
			return result, fmt.Errorf("%w: confirmed entry %d cannot be negative", ErrInvalidDoseInput, entry.ID)
		}
		if entry.EntryType == constants.EntryTypeReversal && entry.DoseMSV > 0 {
			return result, fmt.Errorf("%w: reversal entry %d must be non-positive", ErrInvalidDoseInput, entry.ID)
		}
		if entry.CorrectionOfID != nil {
			result.CorrectedChainCount++
		}
		result.VerifiedEntryCount++
		result.DoseMSV += entry.DoseMSV
		result.IncludedEntryIDs = append(result.IncludedEntryIDs, entry.ID)
	}
	if result.DoseMSV < 0 {
		result.DoseMSV = 0
	}
	result.DoseMSV = roundDose(result.DoseMSV)
	sort.Slice(result.IncludedEntryIDs, func(i, j int) bool { return result.IncludedEntryIDs[i] < result.IncludedEntryIDs[j] })
	sort.Slice(result.ExcludedEntryIDs, func(i, j int) bool { return result.ExcludedEntryIDs[i] < result.ExcludedEntryIDs[j] })
	return result, nil
}

func validateChain(entry model.ExposureEntry, byID map[uint]model.ExposureEntry) error {
	visited := map[uint]bool{entry.ID: true}
	cursor := entry
	for cursor.CorrectionOfID != nil {
		parentID := *cursor.CorrectionOfID
		if visited[parentID] {
			return fmt.Errorf("%w: cycle involving entry %d", ErrCorrectionChain, parentID)
		}
		visited[parentID] = true
		parent, exists := byID[parentID]
		if !exists {
			return nil
		}
		if parent.WorkerID != entry.WorkerID {
			return fmt.Errorf("%w: entries %d and %d belong to different workers", ErrCorrectionChain, entry.ID, parent.ID)
		}
		cursor = parent
	}
	return nil
}
