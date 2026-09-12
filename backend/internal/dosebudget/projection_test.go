package dosebudget

import (
	"math"
	"testing"
)

func TestCalculateProjectionConvertsMinutesToHours(t *testing.T) {
	tests := []struct {
		name        string
		current     float64
		rate        float64
		minutes     int
		wantPlanned float64
		wantTotal   float64
	}{
		{"one hour", 5, 2, 60, 2, 7},
		{"quarter hour", 1, 4, 15, 1, 2},
		{"fractional rate", 3.2, 0.42, 45, 0.315, 3.515},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := CalculateProjection(test.current, test.rate, test.minutes)
			if err != nil {
				t.Fatalf("CalculateProjection returned error: %v", err)
			}
			if got.PlannedDoseMSV != test.wantPlanned || got.ProjectedTotalMSV != test.wantTotal {
				t.Fatalf("projection = %+v, want planned=%v total=%v", got, test.wantPlanned, test.wantTotal)
			}
		})
	}
	if _, err := CalculateProjection(0, math.NaN(), 60); err == nil {
		t.Fatal("NaN rate unexpectedly accepted")
	}
	if _, err := CalculateProjection(0, 1, 0); err == nil {
		t.Fatal("zero minutes unexpectedly accepted")
	}
}
