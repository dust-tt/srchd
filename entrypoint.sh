#!/bin/sh

# THIS FILE IS ONLY INTENDED TO BE RUN IN THE DOCKER CONTAINER

set -e

# Initialize database if it doesn't exist or is empty
DB_PATH="${DATABASE_PATH:-/app/db.sqlite}"
if [ ! -s "$DB_PATH" ]; then
  echo "Initializing database..."
  mkdir -p "$(dirname "$DB_PATH")"
  touch "$DB_PATH"
  npx drizzle-kit push --config=drizzle.config.ts
  echo "Database initialized."
fi

# Start the server
npx tsx src/srchd.ts serve
