package router

import (
	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/handler"
	"radiation-dose-budget-control/backend/internal/middleware"
)

func registerExposureEntryRoutes(group *gin.RouterGroup, target *handler.ExposureEntryHandler) {
	routes := group.Group("/exposures")
	routes.GET("", target.List)
	routes.GET("/:id", target.Get)
	routes.POST("", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Create)
	routes.POST("/:id/verify", middleware.RBAC(constants.RoleRPOReviewer, constants.RoleAdmin), target.Verify)
	routes.POST("/:id/correct", middleware.RBAC(constants.RoleRPOReviewer, constants.RoleAdmin), target.Correct)
}
