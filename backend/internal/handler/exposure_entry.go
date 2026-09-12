package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/service"
)

type ExposureEntryHandler struct{ service *service.ExposureEntryService }

func NewExposureEntryHandler(service *service.ExposureEntryService) *ExposureEntryHandler {
	return &ExposureEntryHandler{service: service}
}

func (handler *ExposureEntryHandler) List(context *gin.Context) {
	page, pageSize := Pagination(context)
	items, meta, err := handler.service.List(page, pageSize, context.Query("worker_id"), context.Query("quality_flag"))
	if err != nil {
		WriteError(context, err)
		return
	}
	WritePage(context, items, meta)
}

func (handler *ExposureEntryHandler) Get(context *gin.Context) {
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

func (handler *ExposureEntryHandler) Create(context *gin.Context) {
	var request dto.CreateExposureEntryRequest
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

func (handler *ExposureEntryHandler) Verify(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	var request dto.VerifyExposureEntryRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Verify(id, request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusOK, item)
}

func (handler *ExposureEntryHandler) Correct(context *gin.Context) {
	id, err := PathID(context)
	if err != nil {
		WriteError(context, err)
		return
	}
	var request dto.CorrectExposureEntryRequest
	if err := BindAndValidate(context, &request); err != nil {
		WriteError(context, err)
		return
	}
	item, err := handler.service.Correct(id, request, Actor(context), RequestID(context))
	if err != nil {
		WriteError(context, err)
		return
	}
	WriteData(context, http.StatusCreated, item)
}
