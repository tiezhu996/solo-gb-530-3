package dosebudget

import (
	"fmt"
	"math"
)

type Projection struct {
	CurrentDoseMSV      float64
	PlannedDoseMSV      float64
	ProjectedTotalMSV   float64
	TimeWeightedRateMSV float64
}

func CalculateProjection(currentDose, estimatedRateMSVH float64, plannedMinutes int) (Projection, error) {
	if !finite(currentDose) || !finite(estimatedRateMSVH) || currentDose < 0 || estimatedRateMSVH < 0 {
		return Projection{}, fmt.Errorf("%w: doses and rates must be finite and non-negative", ErrInvalidDoseInput)
	}
	if plannedMinutes <= 0 || plannedMinutes > 1440 {
		return Projection{}, fmt.Errorf("%w: planned minutes must be from 1 to 1440", ErrInvalidDoseInput)
	}
	plannedDose := estimatedRateMSVH * float64(plannedMinutes) / 60.0
	projected := currentDose + plannedDose
	if !finite(plannedDose) || !finite(projected) {
		return Projection{}, fmt.Errorf("%w: projection overflow", ErrInvalidDoseInput)
	}
	return Projection{
		CurrentDoseMSV: currentDose, PlannedDoseMSV: roundDose(plannedDose),
		ProjectedTotalMSV: roundDose(projected), TimeWeightedRateMSV: roundDose(plannedDose),
	}, nil
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func roundDose(value float64) float64 {
	if value < 0 {
		return 0
	}
	return math.Round(value*1000000) / 1000000
}
