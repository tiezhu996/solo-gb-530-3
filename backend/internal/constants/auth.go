package constants

const (
	RolePlanner     = "planner"
	RoleRPOReviewer = "rpo_reviewer"
	RoleAdmin       = "admin"
)

var Roles = []string{RolePlanner, RoleRPOReviewer, RoleAdmin}

func IsRole(value string) bool {
	for _, role := range Roles {
		if value == role {
			return true
		}
	}
	return false
}

func CanPlan(role string) bool {
	return role == RolePlanner || role == RoleAdmin
}

func CanReview(role string) bool {
	return role == RoleRPOReviewer || role == RoleAdmin
}
