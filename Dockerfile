# Stage 1: Build / Install dependencies
FROM node:26-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy the rest of the source code
COPY . .

# Run build if defined in package.json (falls back gracefully if none)
RUN npm run build || true

# Stage 2: Production / Runtime
FROM node:26-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and production/runtime modules from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./ 

# Expose the port the server listens on (check package.json if your start script uses a different port)
EXPOSE 3000

# Start the application server
CMD ["npm", "start"]
