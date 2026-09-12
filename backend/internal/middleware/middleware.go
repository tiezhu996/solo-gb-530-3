package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/service"
)

func RequestID() gin.HandlerFunc {
	return func(context *gin.Context) {
		requestID := strings.TrimSpace(context.GetHeader("X-Request-ID"))
		if requestID == "" || len(requestID) > 80 {
			requestID = newRequestID()
		}
		context.Set("request_id", requestID)
		context.Header("X-Request-ID", requestID)
		context.Next()
	}
}

func AccessLog() gin.HandlerFunc {
	return func(context *gin.Context) {
		started := time.Now()
		context.Next()
		route := context.FullPath()
		if route == "" {
			route = "unmatched"
		}
		slog.Info("http_request", "request_id", context.GetString("request_id"), "method", context.Request.Method,
			"route", route, "status", context.Writer.Status(), "latency_ms", time.Since(started).Milliseconds(),
			"client_ip", context.ClientIP(), "response_bytes", context.Writer.Size())
	}
}

func Recovery() gin.HandlerFunc {
	return func(context *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("panic recovered", "request_id", context.GetString("request_id"), "panic", recovered, "stack", string(debug.Stack()))
				context.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "internal_error", "message": "unexpected server error"}, "request_id": context.GetString("request_id")})
			}
		}()
		context.Next()
	}
}

type rateBucket struct {
	minute int64
	count  int
}

func RateLimit(limit int) gin.HandlerFunc {
	var mutex sync.Mutex
	buckets := map[string]rateBucket{}
	return func(context *gin.Context) {
		key, minute := context.ClientIP(), time.Now().Unix()/60
		mutex.Lock()
		bucket := buckets[key]
		if bucket.minute != minute {
			bucket = rateBucket{minute: minute}
		}
		bucket.count++
		buckets[key] = bucket
		if len(buckets) > 2048 {
			for candidate, value := range buckets {
				if value.minute < minute-1 {
					delete(buckets, candidate)
				}
			}
		}
		blocked := bucket.count > limit
		mutex.Unlock()
		if blocked {
			context.Header("Retry-After", "60")
			context.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": gin.H{"code": "rate_limited", "message": "local request limit exceeded"}, "request_id": context.GetString("request_id")})
			return
		}
		context.Next()
	}
}

func Auth(authService *service.AuthService) gin.HandlerFunc {
	return func(context *gin.Context) {
		header := context.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			writeAuthError(context, service.Unauthorized("bearer access token is required"))
			return
		}
		actor, err := authService.ParseToken(strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
		if err != nil {
			writeAuthError(context, err)
			return
		}
		context.Set("authenticated_actor", actor)
		context.Next()
	}
}

func RBAC(roles ...string) gin.HandlerFunc {
	allowed := map[string]bool{}
	for _, role := range roles {
		allowed[role] = true
	}
	return func(context *gin.Context) {
		value, ok := context.Get("authenticated_actor")
		if !ok {
			writeAuthError(context, service.Unauthorized("authentication context is missing"))
			return
		}
		actor, ok := value.(dto.Actor)
		if !ok || !allowed[actor.Role] {
			writeAuthError(context, service.Forbidden("role is not allowed to perform this action"))
			return
		}
		context.Next()
	}
}

func CORS(origin string) gin.HandlerFunc {
	return func(context *gin.Context) {
		requestOrigin := context.GetHeader("Origin")
		if requestOrigin != "" && requestOrigin == origin {
			context.Header("Access-Control-Allow-Origin", origin)
			context.Header("Vary", "Origin")
			context.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
			context.Header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		}
		context.Header("X-Content-Type-Options", "nosniff")
		context.Header("X-Frame-Options", "DENY")
		if context.Request.Method == http.MethodOptions {
			context.AbortWithStatus(http.StatusNoContent)
			return
		}
		context.Next()
	}
}

func writeAuthError(context *gin.Context, err error) {
	appError, ok := err.(*service.AppError)
	if !ok {
		appError = service.Unauthorized("authentication failed")
	}
	context.AbortWithStatusJSON(appError.Status, gin.H{"error": gin.H{"code": appError.Code, "message": appError.Message}, "request_id": context.GetString("request_id")})
}

func newRequestID() string {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return time.Now().UTC().Format("20060102T150405.000000000")
	}
	return hex.EncodeToString(buffer)
}
