package dto

import "time"

type CreateWorkerProfileRequest struct {
	WorkerCode             string    `json:"worker_code" validate:"required,min=2,max=40"`
	DisplayName            string    `json:"display_name" validate:"required,min=2,max=120"`
	AuthorizationLevel     string    `json:"authorization_level" validate:"required,min=2,max=60"`
	AnnualLimitMSV         float64   `json:"annual_limit_msv" validate:"required,gt=0,lte=1000"`
	AdministrativeLimitMSV float64   `json:"administrative_limit_msv" validate:"required,gt=0,lte=1000"`
	ProfileStatus          string    `json:"profile_status" validate:"required"`
	PeriodStart            time.Time `json:"period_start" validate:"required"`
}

type UpdateWorkerProfileRequest struct {
	DisplayName            string  `json:"display_name" validate:"required,min=2,max=120"`
	AuthorizationLevel     string  `json:"authorization_level" validate:"required,min=2,max=60"`
	AnnualLimitMSV         float64 `json:"annual_limit_msv" validate:"required,gt=0,lte=1000"`
	AdministrativeLimitMSV float64 `json:"administrative_limit_msv" validate:"required,gt=0,lte=1000"`
	ProfileStatus          string  `json:"profile_status" validate:"required"`
	Version                uint    `json:"version" validate:"required,gt=0"`
}

type WorkerProfileResponse struct {
	ID                     uint      `json:"id"`
	WorkerCode             string    `json:"worker_code"`
	DisplayName            string    `json:"display_name"`
	AuthorizationLevel     string    `json:"authorization_level"`
	AnnualLimitMSV         float64   `json:"annual_limit_msv"`
	AdministrativeLimitMSV float64   `json:"administrative_limit_msv"`
	ProfileStatus          string    `json:"profile_status"`
	PeriodStart            time.Time `json:"period_start"`
	PeriodDoseMSV          float64   `json:"period_dose_msv"`
	RemainingAdminMSV      float64   `json:"remaining_admin_msv"`
	RemainingLegalMSV      float64   `json:"remaining_legal_msv"`
	Version                uint      `json:"version"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}
