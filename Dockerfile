# Use Node.js 20 (required by @google/genai)
FROM node:20-slim

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy all your code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Start the server
CMD ["npm", "start"]