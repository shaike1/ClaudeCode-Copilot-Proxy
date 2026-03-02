FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies, skip lifecycle scripts (prevents husky/postinstall from running)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript manually (bypassing npm scripts to avoid any side-effect hooks)
RUN npx tsc && node -e "require('fs').cpSync('src/public', 'dist/public', {recursive: true})"

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only, skip lifecycle scripts
RUN npm ci --omit=dev --ignore-scripts

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
