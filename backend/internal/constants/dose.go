package constants

const (
	DoseBandWithinAdmin = "within_admin"
	DoseBandAboveAdmin  = "above_admin"
	DoseBandNearLegal   = "near_legal"
	DoseBandAboveLegal  = "above_legal"
	DoseBandInvalid     = "invalid"
)

var DoseBands = []string{
	DoseBandWithinAdmin,
	DoseBandAboveAdmin,
	DoseBandNearLegal,
	DoseBandAboveLegal,
	DoseBandInvalid,
}

const (
	AssessmentStatusCalculated = "calculated"
	AssessmentStatusSubmitted  = "submitted"
	AssessmentStatusAccepted   = "accepted"
	AssessmentStatusRejected   = "rejected"
)

const (
	EntryTypeConfirmed   = "confirmed"
	EntryTypeReversal    = "reversal"
	EntryTypeReplacement = "replacement"
)

const (
	QualityFlagPending  = "pending"
	QualityFlagVerified = "verified"
	QualityFlagRejected = "rejected"
)

func IsEntryType(value string) bool {
	return value == EntryTypeConfirmed || value == EntryTypeReversal || value == EntryTypeReplacement
}

func IsQualityFlag(value string) bool {
	return value == QualityFlagPending || value == QualityFlagVerified || value == QualityFlagRejected
}
