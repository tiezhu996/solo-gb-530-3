FROM node:20-alpine AS builder
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/dist/dose-budget-console/browser /usr/share/nginx/html
EXPOSE 80
