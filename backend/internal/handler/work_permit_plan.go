package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/service"
)

type WorkPermitPlanHandler struct {
	service *service.WorkPermitPlanService
}

func NewWorkPermitPlanHandler(service *service.WorkPermitPlanService) *WorkPermitPlanHandler {
	return &WorkPermitPlanHandler{service: service}
}

func (handler *WorkPermitPlanHandler) List(context *gin.Context) {
	page, pageSize := Pagination(context)
	items, meta, err := handler.service.List(page, pageSize, context.Query("status"), context.Query("worker_id"))
	if err != nil {
		WriteError(context, err)
		return
	}
	WritePage(context, items, meta)
}

func (handler *WorkPermitPlanHandler) Get(context *gin.Context) {
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

func (handler *WorkPermitPlanHandler) Create(context *gin.Context) {
	var request dto.CreateWorkPermitPlanRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Create(request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusCreated, item)
}

func (handler *WorkPermitPlanHandler) Update(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	var request dto.UpdateWorkPermitPlanRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Update(id, request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}

func (handler *WorkPermitPlanHandler) Archive(context *gin.Context) {
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
	item, err := handler.service.Archive(id, request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}
