package dosebudget

import (
	"fmt"

	"radiation-dose-budget-control/backend/internal/constants"
)

type Thresholds struct {
	AdministrativeLimitMSV float64
	LegalLimitMSV          float64
	NearLegalRatio         float64
	Version                string
}

type Decision struct {
	RiskBand              string
	RemainingAdminMSV     float64
	RemainingLegalMSV     float64
	RequiresManualReview  bool
	ThresholdVersion      string
	EscalationExplanation string
}

func Evaluate(projectedDose float64, thresholds Thresholds) (Decision, error) {
	if !finite(projectedDose) || projectedDose < 0 || !finite(thresholds.AdministrativeLimitMSV) ||
		!finite(thresholds.LegalLimitMSV) || thresholds.AdministrativeLimitMSV <= 0 || thresholds.LegalLimitMSV <= 0 {
		return Decision{RiskBand: constants.DoseBandInvalid}, fmt.Errorf("%w: threshold values must be finite and positive", ErrInvalidDoseInput)
	}
	if thresholds.AdministrativeLimitMSV > thresholds.LegalLimitMSV {
		return Decision{RiskBand: constants.DoseBandInvalid}, ErrThresholdOrdering
	}
	if thresholds.NearLegalRatio < 0.5 || thresholds.NearLegalRatio >= 1 {
		return Decision{RiskBand: constants.DoseBandInvalid}, fmt.Errorf("%w: near legal ratio must be in [0.5, 1)", ErrInvalidDoseInput)
	}
	decision := Decision{
		RemainingAdminMSV: roundDose(thresholds.AdministrativeLimitMSV - projectedDose),
		RemainingLegalMSV: roundDose(thresholds.LegalLimitMSV - projectedDose),
		ThresholdVersion:  thresholds.Version,
	}
	switch {
	case projectedDose > thresholds.LegalLimitMSV:
		decision.RiskBand = constants.DoseBandAboveLegal
		decision.RequiresManualReview = true
		decision.EscalationExplanation = "Projection exceeds the configured legal planning threshold; escalate for qualified human review."
	case projectedDose >= thresholds.LegalLimitMSV*thresholds.NearLegalRatio:
		decision.RiskBand = constants.DoseBandNearLegal
		decision.RequiresManualReview = true
		decision.EscalationExplanation = "Projection is near the configured legal threshold; independent RPO review is required."
	case projectedDose > thresholds.AdministrativeLimitMSV:
		decision.RiskBand = constants.DoseBandAboveAdmin
		decision.RequiresManualReview = true
		decision.EscalationExplanation = "Projection exceeds the administrative planning threshold; review controls and assumptions."
	default:
		decision.RiskBand = constants.DoseBandWithinAdmin
		decision.EscalationExplanation = "Projection is within configured planning thresholds; this is not an authorization to work."
	}
	return decision, nil
}
