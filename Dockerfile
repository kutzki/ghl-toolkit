# Use Node.js 18 LTS
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install root dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Install React sub-package dependencies, then build everything
RUN cd src/ui/react-app && npm ci && cd /app && npm run build

# Expose the port
EXPOSE 8000

# Set environment to production
ENV NODE_ENV=production

# Start the HTTP server
CMD ["npm", "start"] 