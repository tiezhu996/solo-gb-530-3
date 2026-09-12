package service

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"radiation-dose-budget-control/backend/internal/dto"
	"radiation-dose-budget-control/backend/internal/repository"
)

type AppError struct {
	Status  int
	Code    string
	Message string
	Cause   error
}

func (err *AppError) Error() string {
	if err.Cause != nil {
		return fmt.Sprintf("%s: %v", err.Message, err.Cause)
	}
	return err.Message
}

func (err *AppError) Unwrap() error { return err.Cause }

func BadRequest(code, message string, causes ...error) *AppError {
	var cause error
	if len(causes) > 0 {
		cause = causes[0]
	}
	return &AppError{Status: http.StatusBadRequest, Code: code, Message: message, Cause: cause}
}
func Unauthorized(message string) *AppError {
	return &AppError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: message}
}
func Forbidden(message string) *AppError {
	return &AppError{Status: http.StatusForbidden, Code: "forbidden", Message: message}
}
func NotFound(resource string, cause error) *AppError {
	return &AppError{Status: http.StatusNotFound, Code: "not_found", Message: resource + " was not found", Cause: cause}
}
func Conflict(code, message string, cause error) *AppError {
	return &AppError{Status: http.StatusConflict, Code: code, Message: message, Cause: cause}
}
func Internal(message string, cause error) *AppError {
	return &AppError{Status: http.StatusInternalServerError, Code: "internal_error", Message: message, Cause: cause}
}

func MapRepositoryError(resource string, err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) || strings.Contains(err.Error(), "record not found") {
		return NotFound(resource, err)
	}
	return Internal("database operation failed", err)
}

type Claims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type AuthService struct {
	repository *repository.SystemRepository
	secret     []byte
	ttl        time.Duration
}

func NewAuthService(repository *repository.SystemRepository, secret string, ttl time.Duration) *AuthService {
	return &AuthService{repository: repository, secret: []byte(secret), ttl: ttl}
}

func (service *AuthService) Login(request dto.LoginRequest) (dto.LoginResponse, error) {
	user, err := service.repository.FindUser(strings.TrimSpace(request.Username))
	if err != nil {
		return dto.LoginResponse{}, Unauthorized("invalid username or password")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(request.Password)) != nil {
		return dto.LoginResponse{}, Unauthorized("invalid username or password")
	}
	now := time.Now().UTC()
	expiresAt := now.Add(service.ttl)
	claims := Claims{
		UserID: user.ID, Username: user.Username, Role: user.Role,
		RegisteredClaims: jwt.RegisteredClaims{Subject: fmtUint(user.ID), IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expiresAt), Issuer: "dose-budget-api"},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(service.secret)
	if err != nil {
		return dto.LoginResponse{}, Internal("could not issue access token", err)
	}
	return dto.LoginResponse{Token: token, ExpiresAt: expiresAt, User: dto.UserView{ID: user.ID, Username: user.Username, Role: user.Role}}, nil
}

func (service *AuthService) ParseToken(encoded string) (dto.Actor, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(encoded, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return service.secret, nil
	}, jwt.WithIssuer("dose-budget-api"), jwt.WithExpirationRequired())
	if err != nil || !token.Valid {
		return dto.Actor{}, Unauthorized("access token is invalid or expired")
	}
	user, err := service.repository.FindActiveUserByID(claims.UserID)
	if err != nil {
		return dto.Actor{}, Unauthorized("access token user is no longer active")
	}
	return dto.Actor{ID: user.ID, Username: user.Username, Role: user.Role}, nil
}

func fmtUint(value uint) string { return fmt.Sprintf("%d", value) }
