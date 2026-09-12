package dto

import "time"

type CreateDoseBudgetAssessmentRequest struct {
	PlanID    uint      `json:"plan_id" validate:"required,gt=0"`
	PeriodEnd time.Time `json:"period_end" validate:"required"`
	Version   uint      `json:"version" validate:"required,gt=0"`
}

type CompareDoseBudgetRequest struct {
	PlanIDs   []uint    `json:"plan_ids" validate:"required,min=2,max=8,dive,gt=0"`
	PeriodEnd time.Time `json:"period_end" validate:"required"`
}

type AssessmentReviewRequest struct {
	Decision string `json:"decision" validate:"required,oneof=accept reject"`
	Note     string `json:"note" validate:"required,min=3,max=1000"`
	Version  uint   `json:"version" validate:"required,gt=0"`
}

type DoseEvidence struct {
	PeriodStart          time.Time `json:"period_start"`
	PeriodEnd            time.Time `json:"period_end"`
	VerifiedEntryCount   int       `json:"verified_entry_count"`
	ExcludedEntryCount   int       `json:"excluded_entry_count"`
	CorrectedChainCount  int       `json:"corrected_chain_count"`
	Formula              string    `json:"formula"`
	ProjectionFormula    string    `json:"projection_formula"`
	AdministrativeLimit  float64   `json:"administrative_limit_msv"`
	AnnualLegalLimit     float64   `json:"annual_legal_limit_msv"`
	NearLegalRatio       float64   `json:"near_legal_ratio"`
	ThresholdVersion     string    `json:"threshold_version"`
	RequiresManualReview bool      `json:"requires_manual_review"`
	EscalationReason     string    `json:"escalation_reason"`
	BoundaryStatement    string    `json:"boundary_statement"`
}

type DoseBudgetAssessmentResponse struct {
	ID                uint                   `json:"id"`
	WorkerID          uint                   `json:"worker_id"`
	WorkerCode        string                 `json:"worker_code"`
	WorkerName        string                 `json:"worker_name"`
	PlanID            uint                   `json:"plan_id"`
	PlanCode          string                 `json:"plan_code"`
	AssessmentStatus  string                 `json:"assessment_status"`
	InputSnapshot     map[string]interface{} `json:"input_snapshot"`
	PeriodDoseMSV     float64                `json:"period_dose_msv"`
	ProjectedDoseMSV  float64                `json:"projected_dose_msv"`
	RemainingAdminMSV float64                `json:"remaining_admin_msv"`
	RemainingLegalMSV float64                `json:"remaining_legal_msv"`
	RiskBand          string                 `json:"risk_band"`
	Evidence          DoseEvidence           `json:"evidence"`
	ThresholdVersion  string                 `json:"threshold_version"`
	PlanVersion       uint                   `json:"plan_version"`
	WorkerVersion     uint                   `json:"worker_version"`
	CreatedAt         time.Time              `json:"created_at"`
	ReviewedBy        *uint                  `json:"reviewed_by,omitempty"`
	ReviewedAt        *time.Time             `json:"reviewed_at,omitempty"`
	ReviewNote        string                 `json:"review_note"`
}

type ScenarioComparisonResponse struct {
	WorkerID          uint                           `json:"worker_id"`
	PeriodDoseMSV     float64                        `json:"period_dose_msv"`
	Scenarios         []DoseBudgetAssessmentResponse `json:"scenarios"`
	HighestRiskBand   string                         `json:"highest_risk_band"`
	BoundaryStatement string                         `json:"boundary_statement"`
}
