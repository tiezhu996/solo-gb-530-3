package dosebudget

import (
	"testing"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/model"
)

func uintPointer(value uint) *uint { return &value }

func TestSummarizeEntriesCorrectionAndQuality(t *testing.T) {
	tests := []struct {
		name        string
		entries     []model.ExposureEntry
		wantDose    float64
		wantCount   int
		wantExclude int
		wantErr     bool
	}{
		{
			name: "verified replacement chain preserves original history",
			entries: []model.ExposureEntry{
				{ID: 1, WorkerID: 7, SourceRef: "A", DoseMSV: 4, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified},
				{ID: 2, WorkerID: 7, SourceRef: "A-REV", DoseMSV: -4, EntryType: constants.EntryTypeReversal, QualityFlag: constants.QualityFlagVerified, CorrectionOfID: uintPointer(1)},
				{ID: 3, WorkerID: 7, SourceRef: "A-C1", DoseMSV: 2.5, EntryType: constants.EntryTypeReplacement, QualityFlag: constants.QualityFlagVerified, CorrectionOfID: uintPointer(2)},
			},
			wantDose: 2.5, wantCount: 3,
		},
		{
			name: "pending and rejected entries excluded",
			entries: []model.ExposureEntry{
				{ID: 1, WorkerID: 7, SourceRef: "A", DoseMSV: 1, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified},
				{ID: 2, WorkerID: 7, SourceRef: "B", DoseMSV: 9, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagPending},
				{ID: 3, WorkerID: 7, SourceRef: "C", DoseMSV: 5, EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagRejected},
			},
			wantDose: 1, wantCount: 1, wantExclude: 2,
		},
		{
			name: "duplicate source rejected",
			entries: []model.ExposureEntry{
				{ID: 1, WorkerID: 7, SourceRef: "DUP", EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified},
				{ID: 2, WorkerID: 7, SourceRef: "DUP", EntryType: constants.EntryTypeConfirmed, QualityFlag: constants.QualityFlagVerified},
			},
			wantErr: true,
		},
		{
			name: "cycle rejected",
			entries: []model.ExposureEntry{
				{ID: 1, WorkerID: 7, SourceRef: "A", EntryType: constants.EntryTypeReplacement, QualityFlag: constants.QualityFlagVerified, CorrectionOfID: uintPointer(2)},
				{ID: 2, WorkerID: 7, SourceRef: "B", EntryType: constants.EntryTypeReplacement, QualityFlag: constants.QualityFlagVerified, CorrectionOfID: uintPointer(1)},
			},
			wantErr: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := SummarizeEntries(test.entries)
			if (err != nil) != test.wantErr {
				t.Fatalf("SummarizeEntries error = %v, wantErr %v", err, test.wantErr)
			}
			if err == nil && (got.DoseMSV != test.wantDose || got.VerifiedEntryCount != test.wantCount || got.ExcludedEntryCount != test.wantExclude) {
				t.Fatalf("summary = %+v", got)
			}
		})
	}
}
