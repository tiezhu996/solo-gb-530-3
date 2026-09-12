package router

import (
	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/handler"
	"radiation-dose-budget-control/backend/internal/middleware"
)

func registerWorkPermitPlanRoutes(group *gin.RouterGroup, target *handler.WorkPermitPlanHandler) {
	routes := group.Group("/plans")
	routes.GET("", target.List)
	routes.GET("/:id", target.Get)
	routes.POST("", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Create)
	routes.PUT("/:id", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Update)
	routes.POST("/:id/archive", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Archive)
}
