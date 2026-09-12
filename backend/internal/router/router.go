package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"radiation-dose-budget-control/backend/internal/config"
	"radiation-dose-budget-control/backend/internal/constants"
	"radiation-dose-budget-control/backend/internal/handler"
	"radiation-dose-budget-control/backend/internal/middleware"
	"radiation-dose-budget-control/backend/internal/repository"
	"radiation-dose-budget-control/backend/internal/service"
)

type handlers struct {
	system      *handler.SystemHandler
	workers     *handler.WorkerProfileHandler
	plans       *handler.WorkPermitPlanHandler
	exposures   *handler.ExposureEntryHandler
	assessments *handler.DoseBudgetAssessmentHandler
	auth        *service.AuthService
}

func New(db *gorm.DB, cfg config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(
		middleware.RequestID(), middleware.AccessLog(), middleware.Recovery(),
		middleware.CORS(cfg.CORSOrigin), middleware.RateLimit(cfg.RateLimitPerMinute),
	)
	wired := wire(db, cfg)
	engine.GET("/healthz", wired.system.Health)
	engine.GET("/readyz", wired.system.Ready)
	api := engine.Group("/api/v1")
	api.POST("/auth/login", wired.system.Login)
	protected := api.Group("")
	protected.Use(middleware.Auth(wired.auth))
	registerWorkerProfileRoutes(protected, wired.workers)
	registerWorkPermitPlanRoutes(protected, wired.plans)
	registerExposureEntryRoutes(protected, wired.exposures)
	registerDoseBudgetAssessmentRoutes(protected, wired.assessments)
	protected.GET("/audit", middleware.RBAC(constants.RoleRPOReviewer, constants.RoleAdmin), wired.system.Audit)
	engine.NoRoute(func(context *gin.Context) {
		context.JSON(http.StatusNotFound, gin.H{
			"error":      gin.H{"code": "route_not_found", "message": "route was not found"},
			"request_id": context.GetString("request_id"),
		})
	})
	return engine
}

func wire(db *gorm.DB, cfg config.Config) handlers {
	workerRepository := repository.NewWorkerProfileRepository(db)
	planRepository := repository.NewWorkPermitPlanRepository(db)
	exposureRepository := repository.NewExposureEntryRepository(db)
	assessmentRepository := repository.NewDoseBudgetAssessmentRepository(db)
	systemRepository := repository.NewSystemRepository(db)
	auditService := service.NewAuditService(systemRepository)
	authService := service.NewAuthService(systemRepository, cfg.JWTSecret, cfg.JWTTTL)
	workerService := service.NewWorkerProfileService(workerRepository, auditService)
	planService := service.NewWorkPermitPlanService(planRepository, workerRepository, assessmentRepository, auditService)
	exposureService := service.NewExposureEntryService(db, exposureRepository, workerRepository, auditService)
	assessmentService := service.NewDoseBudgetAssessmentService(
		db, assessmentRepository, planRepository, workerRepository, exposureRepository, auditService,
		cfg.Thresholds.NearLegalRatio, cfg.Thresholds.Version,
	)
	return handlers{
		system:      handler.NewSystemHandler(authService, auditService, db),
		workers:     handler.NewWorkerProfileHandler(workerService),
		plans:       handler.NewWorkPermitPlanHandler(planService),
		exposures:   handler.NewExposureEntryHandler(exposureService),
		assessments: handler.NewDoseBudgetAssessmentHandler(assessmentService),
		auth:        authService,
	}
}
