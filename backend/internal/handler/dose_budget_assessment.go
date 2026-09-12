package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/service"
)

type DoseBudgetAssessmentHandler struct {
	service *service.DoseBudgetAssessmentService
}

func NewDoseBudgetAssessmentHandler(service *service.DoseBudgetAssessmentService) *DoseBudgetAssessmentHandler {
	return &DoseBudgetAssessmentHandler{service: service}
}

func (handler *DoseBudgetAssessmentHandler) List(context *gin.Context) {
	page, pageSize := Pagination(context)
	items, meta, err := handler.service.List(
		page, pageSize, context.Query("worker_id"), context.Query("plan_id"), context.Query("status"),
	)
	if err != nil {
		WriteError(context, err)
		return
	}
	WritePage(context, items, meta)
}

func (handler *DoseBudgetAssessmentHandler) Get(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Get(id)
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}

func (handler *DoseBudgetAssessmentHandler) Assess(context *gin.Context) {
	var request dto.CreateDoseBudgetAssessmentRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Assess(request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusCreated, item)
}

func (handler *DoseBudgetAssessmentHandler) Compare(context *gin.Context) {
	var request dto.CompareDoseBudgetRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Compare(request)
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}

func (handler *DoseBudgetAssessmentHandler) Submit(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	var request dto.PlanVersionRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Submit(id, request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}

func (handler *DoseBudgetAssessmentHandler) Review(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	var request dto.AssessmentReviewRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Review(id, request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}
