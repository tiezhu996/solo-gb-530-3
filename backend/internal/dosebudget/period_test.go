package dosebudget

import (
	"testing"
	"time"
)

func TestPeriodUsesHalfOpenBoundary(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	period, err := NewPeriod(start, end)
	if err != nil {
		t.Fatalf("NewPeriod returned error: %v", err)
	}
	tests := []struct {
		name string
		at   time.Time
		want bool
	}{
		{"start included", start, true},
		{"inside included", start.Add(time.Hour), true},
		{"last nanosecond included", end.Add(-time.Nanosecond), true},
		{"end excluded", end, false},
		{"before excluded", start.Add(-time.Nanosecond), false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := period.Contains(test.at); got != test.want {
				t.Fatalf("Contains(%s) = %v, want %v", test.at, got, test.want)
			}
		})
	}
}

func TestNewPeriodRejectsInvalidRanges(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, end := range []time.Time{start, start.Add(-time.Second), start.Add(371 * 24 * time.Hour)} {
		if _, err := NewPeriod(start, end); err == nil {
			t.Fatalf("NewPeriod(%s, %s) unexpectedly succeeded", start, end)
		}
	}
}
