package dto

import "time"

type CreateExposureEntryRequest struct {
	WorkerID   uint      `json:"worker_id" validate:"required,gt=0"`
	SourceRef  string    `json:"source_ref" validate:"required,min=3,max=96"`
	OccurredAt time.Time `json:"occurred_at" validate:"required"`
	DoseMSV    float64   `json:"dose_msv" validate:"gte=0,lte=1000"`
	Note       string    `json:"note" validate:"max=500"`
}

type VerifyExposureEntryRequest struct {
	QualityFlag string `json:"quality_flag" validate:"required,oneof=verified rejected"`
	Note        string `json:"note" validate:"max=500"`
}

type CorrectExposureEntryRequest struct {
	SourceRef      string    `json:"source_ref" validate:"required,min=3,max=96"`
	ReplacementMSV float64   `json:"replacement_dose_msv" validate:"gte=0,lte=1000"`
	OccurredAt     time.Time `json:"occurred_at" validate:"required"`
	Note           string    `json:"note" validate:"required,min=3,max=500"`
}

type ExposureEntryResponse struct {
	ID             uint       `json:"id"`
	WorkerID       uint       `json:"worker_id"`
	WorkerCode     string     `json:"worker_code"`
	WorkerName     string     `json:"worker_name"`
	SourceRef      string     `json:"source_ref"`
	OccurredAt     time.Time  `json:"occurred_at"`
	DoseMSV        float64    `json:"dose_msv"`
	EntryType      string     `json:"entry_type"`
	QualityFlag    string     `json:"quality_flag"`
	VerifiedBy     *uint      `json:"verified_by,omitempty"`
	VerifiedAt     *time.Time `json:"verified_at,omitempty"`
	CorrectionOfID *uint      `json:"correction_of_id,omitempty"`
	Note           string     `json:"note"`
	CreatedAt      time.Time  `json:"created_at"`
}

type CorrectionChainResponse struct {
	Original    ExposureEntryResponse `json:"original"`
	Reversal    ExposureEntryResponse `json:"reversal"`
	Replacement ExposureEntryResponse `json:"replacement"`
	NetDoseMSV  float64               `json:"net_dose_msv"`
}
