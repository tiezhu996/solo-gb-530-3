package dto

import "time"

type CreateWorkPermitPlanRequest struct {
	PlanCode          string   `json:"plan_code" validate:"required,min=3,max=48"`
	WorkerID          uint     `json:"worker_id" validate:"required,gt=0"`
	WorkArea          string   `json:"work_area" validate:"required,min=2,max=120"`
	TaskCategory      string   `json:"task_category" validate:"required,min=2,max=80"`
	EstimatedRateMSVH float64  `json:"estimated_rate_msvh" validate:"gte=0,lte=1000"`
	PlannedMinutes    int      `json:"planned_minutes" validate:"required,gt=0,lte=1440"`
	Controls          []string `json:"controls" validate:"required,min=1,max=20,dive,min=2,max=160"`
}

type UpdateWorkPermitPlanRequest struct {
	WorkerID          uint     `json:"worker_id" validate:"required,gt=0"`
	WorkArea          string   `json:"work_area" validate:"required,min=2,max=120"`
	TaskCategory      string   `json:"task_category" validate:"required,min=2,max=80"`
	EstimatedRateMSVH float64  `json:"estimated_rate_msvh" validate:"gte=0,lte=1000"`
	PlannedMinutes    int      `json:"planned_minutes" validate:"required,gt=0,lte=1440"`
	Controls          []string `json:"controls" validate:"required,min=1,max=20,dive,min=2,max=160"`
	Version           uint     `json:"version" validate:"required,gt=0"`
}

type PlanVersionRequest struct {
	Version uint `json:"version" validate:"required,gt=0"`
}

type ReviewPlanRequest struct {
	Version  uint   `json:"version" validate:"required,gt=0"`
	Decision string `json:"decision" validate:"required,oneof=accept reject"`
	Note     string `json:"note" validate:"required,min=3,max=1000"`
}

type WorkPermitPlanResponse struct {
	ID                uint       `json:"id"`
	PlanCode          string     `json:"plan_code"`
	WorkerID          uint       `json:"worker_id"`
	WorkerCode        string     `json:"worker_code"`
	WorkerName        string     `json:"worker_name"`
	WorkArea          string     `json:"work_area"`
	TaskCategory      string     `json:"task_category"`
	EstimatedRateMSVH float64    `json:"estimated_rate_msvh"`
	PlannedMinutes    int        `json:"planned_minutes"`
	ProjectedDoseMSV  float64    `json:"projected_dose_msv"`
	Controls          []string   `json:"controls"`
	PermitStatus      string     `json:"permit_status"`
	Version           uint       `json:"version"`
	ReviewerID        *uint      `json:"reviewer_id,omitempty"`
	ReviewNote        string     `json:"review_note"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ArchivedAt        *time.Time `json:"archived_at,omitempty"`
}
