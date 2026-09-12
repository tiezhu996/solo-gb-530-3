package router

import (
	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/handler"
	"radiation-dose-budget-control/backend/internal/middleware"
)

func registerDoseBudgetAssessmentRoutes(group *gin.RouterGroup, target *handler.DoseBudgetAssessmentHandler) {
	routes := group.Group("/assessments")
	routes.GET("", target.List)
	routes.GET("/:id", target.Get)
	routes.POST("", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Assess)
	routes.POST("/compare", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Compare)
	routes.POST("/:id/submit", middleware.RBAC(constants.RolePlanner, constants.RoleAdmin), target.Submit)
	routes.POST("/:id/review", middleware.RBAC(constants.RoleRPOReviewer, constants.RoleAdmin), target.Review)
}
