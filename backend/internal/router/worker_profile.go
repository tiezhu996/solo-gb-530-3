package router

import (
	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/handler"
	"radiation-dose-budget-control/backend/internal/middleware"
)

func registerWorkerProfileRoutes(group *gin.RouterGroup, target *handler.WorkerProfileHandler) {
	routes := group.Group("/workers")
	routes.GET("", target.List)
	routes.GET("/:id", target.Get)
	routes.POST("", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Create)
	routes.PUT("/:id", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Update)
}
