# Mission Control Bot Dockerfile
FROM node:22-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code and dashboard
COPY src/ ./src/
COPY public/ ./public/

# Build TypeScript
RUN npm run build

EXPOSE 3000

# Run the bot
CMD ["npm", "start"]
