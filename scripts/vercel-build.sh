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
  node scripts/gen-postgres-schema.mjs
  prisma generate --schema=prisma/schema.postgres.prisma
  next build
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
