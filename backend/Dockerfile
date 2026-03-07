# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production image (backend + built frontend)
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/scripts ./scripts
RUN chmod +x ./scripts/reset-password.sh
COPY --from=frontend-builder /build/dist ./frontend-dist
EXPOSE 3000
CMD ["node", "src/index.js"]
