#!/usr/bin/env bash
# Runs an albireo image the way its users do, with a bucket of RustFS, an S3-compatible
# server. It checks that wrong settings stop albireo with an instruction, then uploads a
# file in two parts through the API, reads it back whole and in a range, sends a
# thumbnail and an attachment, edits the library, restarts the container and replaces
# it to check that the library stays in the volume, and deletes the video with its files.
#
# Usage: test/e2e.sh <image>
# Needs docker, curl, jq, and the AWS CLI.
set -euo pipefail

image=${1:?usage: test/e2e.sh <image>}
work=$(mktemp -d)
base=http://127.0.0.1:8080
container=albireo-e2e
bucket_container=albireo-e2e-bucket
volume=albireo-e2e-data
bucket=albireo
passed=false

cleanup() {
  if [[ $passed != true ]]; then
    echo "--- albireo log ---"
    docker logs "$container" 2>&1 | tail -n 100 || true
  fi
  docker rm -f "$container" "$bucket_container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

export AWS_ACCESS_KEY_ID=rustfsadmin AWS_SECRET_ACCESS_KEY=rustfsadmin AWS_DEFAULT_REGION=us-east-1
s3=(aws --endpoint-url http://127.0.0.1:9000 s3api)
settings=(-e S3_ENDPOINT=http://127.0.0.1:9000 -e S3_REGION=us-east-1 -e S3_BUCKET="$bucket" -e S3_URL_STYLE=path
  -e S3_ACCESS_KEY_ID=rustfsadmin -e S3_SECRET_ACCESS_KEY=rustfsadmin)

echo "Start RustFS with a bucket"
docker run -d --name "$bucket_container" -p 9000:9000 rustfs/rustfs:1.0.4 >/dev/null
for _ in $(seq 60); do
  "${s3[@]}" create-bucket --bucket "$bucket" >/dev/null 2>&1 && break
  sleep 1
done
"${s3[@]}" head-bucket --bucket "$bucket" || fail "RustFS has no bucket"

# Runs albireo with the arguments until it stops, and checks that it stopped with an error
# whose message matches the pattern.
expect_stop() {
  local pattern=$1
  shift
  local status=0
  timeout 120 docker run --rm --network host "$@" "$image" >"$work/stop.log" 2>&1 || status=$?
  [[ $status == 1 ]] || { cat "$work/stop.log"; fail "albireo exited with $status, not 1, for $pattern"; }
  jq -R -r 'fromjson? | select(.level == "ERROR") | .message' "$work/stop.log" | grep -q -- "$pattern" \
    || { cat "$work/stop.log"; fail "albireo did not say $pattern"; }
}

echo "Stop with an instruction for each missing setting"
expect_stop "^Please set S3_ENDPOINT to the URL of the S3-compatible API"
expect_stop "^Please set S3_SECRET_ACCESS_KEY to the secret" "${settings[@]:0:10}"

echo "Stop with an instruction for a bucket that does not exist and for a wrong key"
expect_stop "^Please create the bucket missing-bucket" "${settings[@]}" -e S3_BUCKET=missing-bucket
expect_stop "^Please check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY" "${settings[@]}" -e S3_SECRET_ACCESS_KEY=wrong-secret

start_albireo() {
  docker run -d --name "$container" --network host -v "$volume:/data" "${settings[@]}" "$image" >/dev/null
  for _ in $(seq 60); do
    curl -fsS "$base/healthz" >/dev/null 2>&1 && return
    sleep 1
  done
  fail "albireo did not start"
}

echo "Start albireo"
start_albireo
# Contents is missing from the answer when no object matches, which the query counts as none.
left=$("${s3[@]}" list-objects-v2 --bucket "$bucket" --prefix albireo-check/ --query 'length(Contents || `[]`)' --output text)
[[ $left == 0 ]] || { "${s3[@]}" list-objects-v2 --bucket "$bucket" --prefix albireo-check/; fail "the check of the bucket left $left objects behind"; }
api=(-fsS -H 'Content-Type: application/json')
[[ $(curl "${api[@]}" "$base/api/me" | jq -r .me.displayName) == Me ]] || fail "albireo has no person named Me"
curl -fsS "$base/" | grep -q '<div id="root">' || fail "albireo serves no page"
curl -fsS -D "$work/page.headers" -o /dev/null "$base/videos/abc"
grep -qi '^content-security-policy:' "$work/page.headers" || fail "a page has no Content-Security-Policy"

echo "Upload a file of two parts"
head -c $((17 * 1024 * 1024 + 123)) /dev/urandom >"$work/clip.mp4"
size=$(stat -c %s "$work/clip.mp4")
created=$(curl "${api[@]}" -d "{\"title\":\"E2E clip\",\"fileName\":\"clip.mp4\",\"fileSize\":$size,\"contentType\":\"video/mp4\",\"seriesId\":null}" "$base/api/uploads")
id=$(jq -r .videoId <<<"$created")
part_size=$(jq -r .partSize <<<"$created")
part_count=$(jq -r .partCount <<<"$created")
[[ $part_count == 2 ]] || fail "the upload has $part_count parts, not 2"
parts="[]"
for part in $(seq "$part_count"); do
  url=$(curl "${api[@]}" -d "{\"partNumbers\":[$part]}" "$base/api/uploads/$id/parts" | jq -r '.parts[0].url')
  dd if="$work/clip.mp4" of="$work/part" bs="$part_size" skip=$((part - 1)) count=1 status=none
  etag=$(curl -fsS -D - -o /dev/null -T "$work/part" "$base$url" | tr -d '\r' | awk 'tolower($1) == "etag:" { print $2 }')
  [[ -n $etag ]] || fail "part $part came back without an ETag"
  parts=$(jq -c --argjson n "$part" --arg etag "$etag" '. + [{partNumber: $n, etag: $etag}]' <<<"$parts")
done
video=$(curl "${api[@]}" -d "{\"parts\":$parts,\"durationSec\":8,\"width\":1280,\"height\":720}" "$base/api/uploads/$id/complete")
playback=$(jq -r .video.playbackUrl <<<"$video")
[[ $playback == "/api/files/videos/$id/original.mp4" ]] || fail "unexpected playback URL $playback"
[[ $("${s3[@]}" head-object --bucket "$bucket" --key "videos/$id/original.mp4" --query ContentLength) == "$size" ]] \
  || fail "the bucket does not hold the whole file"

echo "Read the file back, whole and in a range"
curl -fsS "$base$playback" -o "$work/back.mp4"
cmp -s "$work/clip.mp4" "$work/back.mp4" || fail "the file came back changed"
status=$(curl -sS -o "$work/range" -w '%{http_code}' -H 'Range: bytes=1000-1999' "$base$playback")
[[ $status == 206 ]] || fail "a range answered $status"
dd if="$work/clip.mp4" of="$work/expected-range" bs=1000 skip=1 count=1 status=none
cmp -s "$work/expected-range" "$work/range" || fail "the range came back changed"
etag=$(curl -fsS -D - -o /dev/null "$base$playback" | tr -d '\r' | awk 'tolower($1) == "etag:" { print $2 }')
status=$(curl -sS -o /dev/null -w '%{http_code}' -H "If-None-Match: $etag" "$base$playback")
[[ $status == 304 ]] || fail "a revalidation answered $status"

echo "Send a thumbnail and an attachment"
{ printf '\xff\xd8\xff\xe0'; head -c 4000 /dev/urandom; } >"$work/thumbnail.jpg"
url=$(curl "${api[@]}" -X POST "$base/api/videos/$id/thumbnail" | jq -r .url)
curl -fsS -T "$work/thumbnail.jpg" -H 'Content-Type: image/jpeg' "$base$url"
thumbnail=$(curl "${api[@]}" -X POST "$base/api/videos/$id/thumbnail/commit" | jq -r .video.thumbnailUrl)
curl -fsS "$base$thumbnail" | cmp -s - "$work/thumbnail.jpg" || fail "the thumbnail came back changed"
printf '# Notes\n\nThe weekly sync, in short.\n' >"$work/notes.md"
started=$(curl "${api[@]}" -d "{\"fileName\":\"notes.md\",\"fileSize\":$(stat -c %s "$work/notes.md")}" "$base/api/videos/$id/attachments")
curl -fsS -T "$work/notes.md" -H 'Content-Type: text/markdown' "$base$(jq -r .url <<<"$started")"
attachment=$(curl "${api[@]}" -X POST "$base/api/attachments/$(jq -r .attachmentId <<<"$started")/commit")
curl -fsS -D "$work/download.headers" "$base$(jq -r .attachment.downloadUrl <<<"$attachment")" | cmp -s - "$work/notes.md" \
  || fail "the attachment came back changed"
grep -qi '^content-disposition: attachment; filename="notes.md"' "$work/download.headers" || fail "the download has no name"

echo "Edit the library"
curl "${api[@]}" -X PATCH -d '{"displayName":"E2E"}' "$base/api/me" >/dev/null
series=$(curl "${api[@]}" -d '{"title":"E2E series","description":""}' "$base/api/series" | jq -r .series.id)
curl "${api[@]}" -X PATCH -d "{\"seriesId\":\"$series\"}" "$base/api/videos/$id" >/dev/null
curl "${api[@]}" -d '{"body":"At 0:02 the parts meet."}' "$base/api/videos/$id/comments" >/dev/null
curl "${api[@]}" -X PUT -d '{"stars":5}' "$base/api/videos/$id/rating" >/dev/null
[[ $(curl "${api[@]}" "$base/api/search?q=E2E" | jq -r '.videos[0].id') == "$id" ]] || fail "search did not find the video"
status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: cross-site' \
  -d '{"title":"Spam","description":""}' "$base/api/series")
[[ $status == 403 ]] || fail "a change from another site answered $status"

check_library() {
  local summary
  summary=$(curl "${api[@]}" "$base/api/videos" | jq -c '.videos[0] | {id, series: .series.title, ratingAverage, commentCount, attachmentCount, uploader: .uploader.displayName}')
  [[ $summary == "{\"id\":\"$id\",\"series\":\"E2E series\",\"ratingAverage\":5,\"commentCount\":1,\"attachmentCount\":1,\"uploader\":\"E2E\"}" ]] \
    || fail "the library is not as it was: $summary"
}
check_library

echo "Restart albireo, then replace its container, and keep the library"
docker restart "$container" >/dev/null
for _ in $(seq 60); do curl -fsS "$base/healthz" >/dev/null 2>&1 && break; sleep 1; done
check_library
docker stop "$container" >/dev/null
[[ $(docker inspect -f '{{.State.ExitCode}}' "$container") == 0 ]] || fail "albireo did not stop cleanly"
docker rm "$container" >/dev/null
start_albireo
check_library

echo "Delete the video with its files"
thumbnail_key=thumbnails/$id.jpg
attachment_key=attachments/$id/$(jq -r .attachment.id <<<"$attachment")
curl -fsS -X DELETE "$base/api/videos/$id"
for key in "videos/$id/original.mp4" "$thumbnail_key" "$attachment_key"; do
  if "${s3[@]}" head-object --bucket "$bucket" --key "$key" >/dev/null 2>&1; then fail "the bucket still holds $key"; fi
done
[[ $(curl "${api[@]}" "$base/api/videos" | jq '.videos | length') == 0 ]] || fail "the video is still in the library"

echo "Check that the log has no error"
errors=$(docker logs "$container" 2>&1 | jq -R -c 'fromjson? | select(.level == "ERROR")')
[[ -z $errors ]] || fail "albireo logged errors: $errors"

passed=true
echo "PASS"
