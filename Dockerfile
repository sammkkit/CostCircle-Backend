# Use a lightweight version of Node 20 as the base (Alpine Linux)
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package definitions first (better caching)
COPY package*.json ./

# Install only production dependencies to keep the image small
# (If you need devDependencies for build, remove '--only=production')
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port the app runs on (Documentation only, Railway overrides this)
EXPOSE 3000

# The command to start your application
CMD ["npm", "start"]