package dosebudget

import (
	"testing"

	"radiation-dose-budget-control/backend/internal/constants"
)

func TestEvaluateRiskBands(t *testing.T) {
	thresholds := Thresholds{AdministrativeLimitMSV: 12, LegalLimitMSV: 20, NearLegalRatio: 0.9, Version: "T1"}
	tests := []struct {
		projected float64
		want      string
		manual    bool
	}{
		{8, constants.DoseBandWithinAdmin, false},
		{12.5, constants.DoseBandAboveAdmin, true},
		{18, constants.DoseBandNearLegal, true},
		{20, constants.DoseBandNearLegal, true},
		{20.01, constants.DoseBandAboveLegal, true},
	}
	for _, test := range tests {
		got, err := Evaluate(test.projected, thresholds)
		if err != nil {
			t.Fatalf("Evaluate(%v) returned error: %v", test.projected, err)
		}
		if got.RiskBand != test.want || got.RequiresManualReview != test.manual {
			t.Fatalf("Evaluate(%v) = %+v, want band=%s manual=%v", test.projected, got, test.want, test.manual)
		}
		if got.RemainingAdminMSV < 0 || got.RemainingLegalMSV < 0 {
			t.Fatalf("remaining values must be clamped: %+v", got)
		}
	}
}
