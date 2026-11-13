---
title: "Commands"
description: "The commands of the albireo image: serve, healthcheck, backup, and restore."
---

The image runs `albireo serve`, unless the command of the container names another command (Dockerfile).
Every command reads the environment variables that [Configuration](../configuration/) describes, and writes its log as one JSON object per line.
A command that stops on a problem exits with 1, and its log says what to change, starting with "Please" (server/src/main.rs).

## serve

Serves the browser app and the API on port 8080, until the container stops.

1. It connects to the database, and applies the migrations that the database lacks.
2. It checks the access key on the bucket, under `albireo-check/`.
3. While albireo has nobody, it writes a setup code to its log.
4. It serves. On SIGTERM, as from `docker stop`, it lets the requests that run finish for up to 5 seconds, and exits with 0.

## healthcheck

Asks the albireo of the same container for `GET /healthz`, and exits with 0 when it answers `ok`, or with 1.
The health check of the image runs it every 30 seconds.

## backup

Writes a copy of the database to `backups/albireo-<UTC time>.sql.gz` in the bucket, and exits with 0 (server/src/backup.rs).

- It reads the database in one snapshot, and changes nothing in it, so it runs beside the servers.
- It needs the same version of albireo as the database: it stops when the migrations of the database differ from its own.
- The last line of its log names the copy, with its size in bytes and its number of rows.

```bash
# Write a copy of the database of compose.yaml to the bucket
# run --rm : start a container of the albireo service for this command alone, and remove it after
docker compose run --rm albireo backup
```

## restore

Loads a copy from the bucket into an empty database, and exits with 0.

- It takes one argument, the name of the copy in the bucket, such as `backups/albireo-20261114T031500Z.sql.gz`.
- It applies the migrations to the database first, then loads every table of the copy in one transaction, so the database ends with the whole copy or with nothing.
- It stops when the database has a library already, when the copy comes from a version of albireo with other migrations, and when the copy is not whole.

```bash
# Load a copy into the empty database of compose.yaml
# restore <key> : the copy to load, by its name in the bucket
docker compose run --rm albireo restore backups/albireo-20261114T031500Z.sql.gz
```
