package dto

import "time"

type LoginRequest struct {
	Username string `json:"username" validate:"required,min=3,max=80"`
	Password string `json:"password" validate:"required,min=8,max=120"`
}

type LoginResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      UserView  `json:"user"`
}

type UserView struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Actor struct {
	ID       uint
	Username string
	Role     string
}

type PageMeta struct {
	Page       int   `json:"page"`
	PageSize   int   `json:"page_size"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"total_pages"`
}

type AuditEventResponse struct {
	ID            uint                   `json:"id"`
	Actor         string                 `json:"actor"`
	Role          string                 `json:"role"`
	Action        string                 `json:"action"`
	ResourceType  string                 `json:"resource_type"`
	ResourceID    string                 `json:"resource_id"`
	RequestID     string                 `json:"request_id"`
	Parameters    map[string]interface{} `json:"parameters"`
	BeforeSummary map[string]interface{} `json:"before_summary"`
	AfterSummary  map[string]interface{} `json:"after_summary"`
	CreatedAt     time.Time              `json:"created_at"`
}
