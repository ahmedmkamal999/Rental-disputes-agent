# Use Node.js
FROM node:18

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install
# Install TypeScript runner so we can run .ts files directly
RUN npm install -g ts-node typescript

# Copy all your code
COPY . .

# Start the server (make sure your package.json script is "start": "ts-node index.ts")
CMD ["npm", "start"]