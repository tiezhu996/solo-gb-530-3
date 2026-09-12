FROM golang:1.22-alpine AS builder
RUN apk add --no-cache build-base
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/dose-budget-api ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /out/dose-budget-api /app/server
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/app/server"]
