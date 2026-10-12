#!/bin/sh
# THE HOSTED BUILD. The deployment carries its own database: the seed runs at build time into
# prisma/rosie.db (SQLite) and the file ships inside every function (next.config
# outputFileTracingIncludes), so there is no database service to set up, expire or wake — and a
# failed seed fails the build while the previous deployment keeps serving its own bundled database.
# Set ROSIE_DB=postgres (with POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED or DATABASE_URL) to
# run against a hosted Postgres instead: then the build proves itself first and touches the
# database last.
set -e
if [ "$ROSIE_DB" = "postgres" ]; then
  export POSTGRES_URL_NON_POOLING="${POSTGRES_URL_NON_POOLING:-${DATABASE_URL_UNPOOLED:-$DATABASE_URL}}"
  # A serverless Postgres (Neon) sleeps when idle and takes longer than Prisma's 5-second default to
  # wake: the first hosted deploy failed at db push with P1001 five seconds in. The app's client already
  # waits 30 s (src/lib/db.ts); the CLI and the seed read this URL as given, so it carries the same
  # timeouts here, and the build pings the database until it answers before creating the tables.
  case "$POSTGRES_URL_NON_POOLING" in
    *connect_timeout=*) ;;
    *\?*) export POSTGRES_URL_NON_POOLING="${POSTGRES_URL_NON_POOLING}&connect_timeout=30&pool_timeout=30" ;;
    *) export POSTGRES_URL_NON_POOLING="${POSTGRES_URL_NON_POOLING}?connect_timeout=30&pool_timeout=30" ;;
  esac
  node scripts/gen-postgres-schema.mjs
  prisma generate --schema=prisma/schema.postgres.prisma
  next build
  attempt=1
  until echo "select 1" | prisma db execute --schema=prisma/schema.postgres.prisma --stdin > /dev/null 2>&1; do
    if [ "$attempt" -ge 6 ]; then echo "The database did not answer after $attempt attempts."; exit 1; fi
    echo "Waiting for the database to wake (attempt $attempt)…"
    attempt=$((attempt + 1)); sleep 10
  done
  prisma db push --schema=prisma/schema.postgres.prisma --skip-generate --force-reset --accept-data-loss
  tsx prisma/seed.ts
else
  # One file for every step of the build: the Prisma CLI and the seed's own client read DATABASE_URL; the app's
  # client (src/lib/db.ts), which the seed also reaches through the scheduler and the plan writer, reads
  # ROSIE_DB_FILE — never the /tmp copy the runtime uses, since Vercel sets VERCEL=1 during the build too.
  export DATABASE_URL="file:$PWD/prisma/rosie.db"
  export ROSIE_DB_FILE="$PWD/prisma/rosie.db"
  rm -f prisma/rosie.db prisma/rosie.db-journal
  prisma generate
  prisma db push --skip-generate --force-reset --accept-data-loss
  tsx prisma/seed.ts
  ls -la prisma/rosie.db
  unset ROSIE_DB_FILE
  next build
fi
