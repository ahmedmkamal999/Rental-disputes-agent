# Use Node.js
FROM node:18

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