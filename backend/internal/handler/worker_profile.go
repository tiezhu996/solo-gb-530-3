package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/service"
)

type WorkerProfileHandler struct{ service *service.WorkerProfileService }

func NewWorkerProfileHandler(service *service.WorkerProfileService) *WorkerProfileHandler {
	return &WorkerProfileHandler{service: service}
}

func (handler *WorkerProfileHandler) List(context *gin.Context) {
	page, pageSize := Pagination(context)
	items, meta, err := handler.service.List(page, pageSize, context.Query("status"), context.Query("search"))
	if err != nil {
		WriteError(context, err)
		return
	}
	WritePage(context, items, meta)
}

func (handler *WorkerProfileHandler) Get(context *gin.Context) {
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

func (handler *WorkerProfileHandler) Create(context *gin.Context) {
	var request dto.CreateWorkerProfileRequest
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

func (handler *WorkerProfileHandler) Update(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	var request dto.UpdateWorkerProfileRequest
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
