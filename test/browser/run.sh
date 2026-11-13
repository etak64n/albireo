#!/usr/bin/env bash
# Runs the browser app of an albireo image in Google Chrome. It makes a short clip and a
# file of notes, starts PostgreSQL, RustFS, an S3-compatible server, and albireo, and runs
# app.mjs with the setup code from the log of albireo. app.mjs uses albireo the way its people
# do and keeps a screenshot of each step in test/browser/out/.
#
# Usage: test/browser/run.sh <image>
# Needs docker, ffmpeg, jq, the AWS CLI, Node.js, and Google Chrome, and
# `pnpm --dir test/browser install` before.
set -euo pipefail

image=${1:?usage: test/browser/run.sh <image>}
here=$(cd "$(dirname "$0")" && pwd)
out=$here/out
work=$(mktemp -d)
network=albireo-browser
container=albireo-browser
database=albireo-browser-db
bucket_container=albireo-browser-bucket
passed=false

cleanup() {
  if [[ $passed != true ]]; then
    echo "--- albireo log ---"
    docker logs "$container" 2>&1 | tail -n 100 || true
  fi
  docker rm -f "$container" "$database" "$bucket_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "Make the clip and the notes"
# Eight seconds of a test pattern with a tone, in the H.264 and AAC that browsers play.
ffmpeg -hide_banner -loglevel error -f lavfi -i "testsrc2=s=1280x720:r=30:d=8" -f lavfi -i "sine=f=440:d=8" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart "$work/Sample clip.mp4"
printf '# Notes of the sample clip\n\n- The test pattern moves for eight seconds.\n- The tone is 440 Hz.\n' >"$work/notes.md"

echo "Start PostgreSQL, RustFS with a bucket, and albireo"
export AWS_ACCESS_KEY_ID=rustfsadmin AWS_SECRET_ACCESS_KEY=rustfsadmin AWS_DEFAULT_REGION=us-east-1
docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" -e POSTGRES_USER=albireo -e POSTGRES_PASSWORD=browser-password \
  -e POSTGRES_DB=albireo postgres:18.7 >/dev/null
docker run -d --name "$bucket_container" --network "$network" -p 127.0.0.1:9000:9000 rustfs/rustfs:1.0.4 >/dev/null
for _ in $(seq 60); do
  aws --endpoint-url http://127.0.0.1:9000 s3api create-bucket --bucket albireo >/dev/null 2>&1 && break
  sleep 1
done
docker run -d --name "$container" --network "$network" -p 127.0.0.1:8080:8080 \
  -e DATABASE_URL="postgres://albireo:browser-password@$database:5432/albireo" -e S3_ENDPOINT="http://$bucket_container:9000" \
  -e S3_REGION=us-east-1 -e S3_BUCKET=albireo -e S3_URL_STYLE=path -e S3_ACCESS_KEY_ID=rustfsadmin -e S3_SECRET_ACCESS_KEY=rustfsadmin \
  "$image" >/dev/null
for _ in $(seq 90); do
  curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1 && break
  sleep 1
done
code=$(docker logs "$container" 2>/dev/null | jq -R -r 'fromjson? | select(.setupCode != null) | .setupCode' | tail -n 1)
[[ -n $code ]] || { echo "albireo wrote no setup code to its log" >&2; exit 1; }

rm -rf "$out"
node "$here/app.mjs" http://127.0.0.1:8080 "$code" "$work/Sample clip.mp4" "$work/notes.md" "$out"
passed=true
