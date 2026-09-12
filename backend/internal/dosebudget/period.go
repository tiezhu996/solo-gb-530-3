package dosebudget

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrInvalidPeriod     = errors.New("invalid assessment period")
	ErrInvalidDoseInput  = errors.New("invalid dose input")
	ErrCorrectionChain   = errors.New("invalid correction chain")
	ErrDuplicateSource   = errors.New("duplicate source reference")
	ErrThresholdOrdering = errors.New("administrative limit must not exceed legal limit")
)

type Period struct {
	Start time.Time
	End   time.Time
}

func NewPeriod(start, end time.Time) (Period, error) {
	start = start.UTC()
	end = end.UTC()
	if start.IsZero() || end.IsZero() || !end.After(start) {
		return Period{}, fmt.Errorf("%w: end must be after start", ErrInvalidPeriod)
	}
	if end.Sub(start) > 370*24*time.Hour {
		return Period{}, fmt.Errorf("%w: range cannot exceed 370 days", ErrInvalidPeriod)
	}
	return Period{Start: start, End: end}, nil
}

func (period Period) Contains(value time.Time) bool {
	value = value.UTC()
	return !value.Before(period.Start) && value.Before(period.End)
}

func (period Period) ElapsedFraction(value time.Time) float64 {
	if !value.After(period.Start) {
		return 0
	}
	if !value.Before(period.End) {
		return 1
	}
	return value.Sub(period.Start).Seconds() / period.End.Sub(period.Start).Seconds()
}
