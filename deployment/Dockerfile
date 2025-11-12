FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
COPY drizzle.config.ts .
COPY tsconfig.json .
RUN npm ci

# Copy code and data
COPY prompts prompts
COPY problems problems
COPY src src

ENV DATABASE_PATH="/data/db.sqlite"

EXPOSE 1337

# Create DB, run migrations, and start server
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT [ "/entrypoint.sh" ]
