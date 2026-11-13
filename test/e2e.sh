#!/usr/bin/env bash
# Runs an albireo image the way its users do: two containers of albireo that share a
# PostgreSQL database and a bucket of RustFS, an S3-compatible server. It checks that wrong
# settings stop albireo with an instruction, creates the first admin with the setup code from
# the log, and signs in. Across both containers, it uploads a file in two parts, reads it back
# whole and in a range, sends a thumbnail and an attachment, invites a member, and edits the
# library. It then restarts the containers and replaces one, to check that the library and the
# sessions stay in the database, removes the member, and deletes the video with its files.
#
# Usage: test/e2e.sh <image>
# Needs docker, curl, jq, and the AWS CLI.
set -euo pipefail

image=${1:?usage: test/e2e.sh <image>}
work=$(mktemp -d)
network=albireo-e2e
first=albireo-e2e-1
second=albireo-e2e-2
database=albireo-e2e-db
bucket_container=albireo-e2e-bucket
bucket=albireo
# The two containers of albireo, each on a port of its own.
one=http://127.0.0.1:8081
two=http://127.0.0.1:8082
passed=false

cleanup() {
  if [[ $passed != true ]]; then
    for container in "$first" "$second"; do
      echo "--- log of $container ---"
      docker logs "$container" 2>&1 | tail -n 60 || true
    done
  fi
  docker rm -f "$first" "$second" "$database" "$bucket_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

export AWS_ACCESS_KEY_ID=rustfsadmin AWS_SECRET_ACCESS_KEY=rustfsadmin AWS_DEFAULT_REGION=us-east-1
s3=(aws --endpoint-url http://127.0.0.1:9000 s3api)
settings=(-e DATABASE_URL="postgres://albireo:e2e-password@$database:5432/albireo" -e S3_ENDPOINT="http://$bucket_container:9000"
  -e S3_REGION=us-east-1 -e S3_BUCKET="$bucket" -e S3_URL_STYLE=path -e S3_ACCESS_KEY_ID=rustfsadmin -e S3_SECRET_ACCESS_KEY=rustfsadmin)

echo "Start PostgreSQL and RustFS with a bucket"
docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" -e POSTGRES_USER=albireo -e POSTGRES_PASSWORD=e2e-password \
  -e POSTGRES_DB=albireo postgres:18.7 >/dev/null
docker run -d --name "$bucket_container" --network "$network" -p 127.0.0.1:9000:9000 rustfs/rustfs:1.0.4 >/dev/null
# Over TCP, which PostgreSQL opens only once it has prepared its first database.
for _ in $(seq 60); do
  docker exec "$database" pg_isready --host 127.0.0.1 --username albireo --dbname albireo >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$database" pg_isready --host 127.0.0.1 --username albireo --dbname albireo >/dev/null || fail "PostgreSQL did not start"
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
  timeout 120 docker run --rm --network "$network" "$@" "$image" >"$work/stop.log" 2>&1 || status=$?
  [[ $status == 1 ]] || { cat "$work/stop.log"; fail "albireo exited with $status, not 1, for $pattern"; }
  jq -R -r 'fromjson? | select(.level == "ERROR") | .message' "$work/stop.log" | grep -q -- "$pattern" \
    || { cat "$work/stop.log"; fail "albireo did not say $pattern"; }
}

echo "Stop with an instruction for each missing setting"
expect_stop "^Please set DATABASE_URL to the connection string"
# Every setting but the last one, the secret of the access key.
expect_stop "^Please set S3_SECRET_ACCESS_KEY to the secret" "${settings[@]:0:12}"

echo "Stop with an instruction for a wrong password, a bucket that does not exist, and a wrong key"
expect_stop "^Please check DATABASE_URL" "${settings[@]}" -e DATABASE_URL="postgres://albireo:wrong@$database:5432/albireo"
expect_stop "^Please create the bucket missing-bucket" "${settings[@]}" -e S3_BUCKET=missing-bucket
expect_stop "^Please check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY" "${settings[@]}" -e S3_SECRET_ACCESS_KEY=wrong-secret

start_albireo() {
  docker run -d --name "$1" --network "$network" -p "127.0.0.1:$2:8080" "${settings[@]}" "$image" >/dev/null
}

wait_for() {
  for _ in $(seq 90); do
    curl -fsS "$1/healthz" >/dev/null 2>&1 && return
    sleep 1
  done
  fail "albireo at $1 did not start"
}

echo "Start two containers of albireo at once, which prepare the database together"
start_albireo "$first" 8081
start_albireo "$second" 8082
wait_for "$one"
wait_for "$two"
# Contents is missing from the answer when no object matches, which the query counts as none.
left=$("${s3[@]}" list-objects-v2 --bucket "$bucket" --prefix albireo-check/ --query 'length(Contents || `[]`)' --output text)
[[ $left == 0 ]] || { "${s3[@]}" list-objects-v2 --bucket "$bucket" --prefix albireo-check/; fail "the check of the bucket left $left objects behind"; }
curl -fsS "$one/" | grep -q '<div id="root">' || fail "albireo serves no page"
curl -fsS -D "$work/page.headers" -o /dev/null "$one/videos/abc"
grep -qi '^content-security-policy:' "$work/page.headers" || fail "a page has no Content-Security-Policy"

json=(-H 'Content-Type: application/json')
# Each person keeps their session cookie in a file of their own, which both containers accept.
admin=(-fsS "${json[@]}" -b "$work/admin.jar" -c "$work/admin.jar")
member=(-fsS "${json[@]}" -b "$work/member.jar" -c "$work/member.jar")

echo "Create the first admin with the setup code from the log"
[[ $(curl -sS "$one/api/me" | jq -r .error.code) == setup_needed ]] || fail "albireo does not ask for the setup"
code=$(docker logs "$first" 2>/dev/null | jq -R -r 'fromjson? | select(.setupCode != null) | .setupCode' | tail -n 1)
[[ -n $code ]] || fail "albireo wrote no setup code to its log"
# The code of one container works on the other, since both keep their codes in the database.
curl "${admin[@]}" -d "{\"setupCode\":\"$code\",\"email\":\"admin@example.com\",\"displayName\":\"Admin\",\"password\":\"correct horse battery\"}" \
  "$two/api/setup" >/dev/null
[[ $(curl "${admin[@]}" "$one/api/me" | jq -r .me.isAdmin) == true ]] || fail "the session from one container does not work on the other"
status=$(curl -sS -o /dev/null -w '%{http_code}' "${json[@]}" \
  -d "{\"setupCode\":\"$code\",\"email\":\"other@example.com\",\"displayName\":\"Other\",\"password\":\"correct horse battery\"}" "$one/api/setup")
[[ $status == 409 ]] || fail "a second setup answered $status"
status=$(curl -sS -o /dev/null -w '%{http_code}' "${json[@]}" -d '{"email":"admin@example.com","password":"wrong horse battery"}' "$one/api/sign-in")
[[ $status == 401 ]] || fail "a wrong password answered $status"

echo "Upload a file of two parts, one through each container"
head -c $((17 * 1024 * 1024 + 123)) /dev/urandom >"$work/clip.mp4"
size=$(stat -c %s "$work/clip.mp4")
created=$(curl "${admin[@]}" -d "{\"title\":\"E2E clip\",\"fileName\":\"clip.mp4\",\"fileSize\":$size,\"contentType\":\"video/mp4\",\"seriesId\":null}" "$one/api/uploads")
id=$(jq -r .videoId <<<"$created")
part_size=$(jq -r .partSize <<<"$created")
part_count=$(jq -r .partCount <<<"$created")
[[ $part_count == 2 ]] || fail "the upload has $part_count parts, not 2"
parts="[]"
for part in $(seq "$part_count"); do
  base=$([[ $part == 1 ]] && echo "$one" || echo "$two")
  url=$(curl "${admin[@]}" -d "{\"partNumbers\":[$part]}" "$base/api/uploads/$id/parts" | jq -r '.parts[0].url')
  dd if="$work/clip.mp4" of="$work/part" bs="$part_size" skip=$((part - 1)) count=1 status=none
  etag=$(curl -fsS -b "$work/admin.jar" -D - -o /dev/null -T "$work/part" "$base$url" | tr -d '\r' | awk 'tolower($1) == "etag:" { print $2 }')
  [[ -n $etag ]] || fail "part $part came back without an ETag"
  parts=$(jq -c --argjson n "$part" --arg etag "$etag" '. + [{partNumber: $n, etag: $etag}]' <<<"$parts")
done
video=$(curl "${admin[@]}" -d "{\"parts\":$parts,\"durationSec\":8,\"width\":1280,\"height\":720}" "$one/api/uploads/$id/complete")
playback=$(jq -r .video.playbackUrl <<<"$video")
[[ $playback == "/api/files/videos/$id/original.mp4" ]] || fail "unexpected playback URL $playback"
[[ $("${s3[@]}" head-object --bucket "$bucket" --key "videos/$id/original.mp4" --query ContentLength) == "$size" ]] \
  || fail "the bucket does not hold the whole file"

echo "Read the file back, whole and in a range"
curl -fsS -b "$work/admin.jar" "$two$playback" -o "$work/back.mp4"
cmp -s "$work/clip.mp4" "$work/back.mp4" || fail "the file came back changed"
status=$(curl -sS -b "$work/admin.jar" -o "$work/range" -w '%{http_code}' -H 'Range: bytes=1000-1999' "$one$playback")
[[ $status == 206 ]] || fail "a range answered $status"
dd if="$work/clip.mp4" of="$work/expected-range" bs=1000 skip=1 count=1 status=none
cmp -s "$work/expected-range" "$work/range" || fail "the range came back changed"
etag=$(curl -fsS -b "$work/admin.jar" -D - -o /dev/null "$one$playback" | tr -d '\r' | awk 'tolower($1) == "etag:" { print $2 }')
status=$(curl -sS -b "$work/admin.jar" -o /dev/null -w '%{http_code}' -H "If-None-Match: $etag" "$two$playback")
[[ $status == 304 ]] || fail "a revalidation answered $status"
status=$(curl -sS -o /dev/null -w '%{http_code}' "$one$playback")
[[ $status == 401 ]] || fail "a file answered $status without a session"

echo "Send a thumbnail and an attachment"
{ printf '\xff\xd8\xff\xe0'; head -c 4000 /dev/urandom; } >"$work/thumbnail.jpg"
url=$(curl "${admin[@]}" -X POST "$one/api/videos/$id/thumbnail" | jq -r .url)
curl -fsS -b "$work/admin.jar" -T "$work/thumbnail.jpg" -H 'Content-Type: image/jpeg' "$two$url"
thumbnail=$(curl "${admin[@]}" -X POST "$one/api/videos/$id/thumbnail/commit" | jq -r .video.thumbnailUrl)
curl -fsS -b "$work/admin.jar" "$two$thumbnail" | cmp -s - "$work/thumbnail.jpg" || fail "the thumbnail came back changed"
printf '# Notes\n\nThe weekly sync, in short.\n' >"$work/notes.md"
started=$(curl "${admin[@]}" -d "{\"fileName\":\"notes.md\",\"fileSize\":$(stat -c %s "$work/notes.md")}" "$one/api/videos/$id/attachments")
curl -fsS -b "$work/admin.jar" -T "$work/notes.md" -H 'Content-Type: text/markdown' "$two$(jq -r .url <<<"$started")"
attachment=$(curl "${admin[@]}" -X POST "$one/api/attachments/$(jq -r .attachmentId <<<"$started")/commit")
curl -fsS -b "$work/admin.jar" -D "$work/download.headers" "$two$(jq -r .attachment.downloadUrl <<<"$attachment")" | cmp -s - "$work/notes.md" \
  || fail "the attachment came back changed"
grep -qi '^content-disposition: attachment; filename="notes.md"' "$work/download.headers" || fail "the download has no name"

echo "Invite a member, who joins through the other container"
token=$(curl "${admin[@]}" -d '{"isAdmin":false}' "$one/api/invitations" | jq -r .token)
member_id=$(curl "${member[@]}" -d '{"email":"sam@example.com","displayName":"Sam","password":"a long password"}' "$two/api/join/$token" | jq -r .me.id)
[[ $(curl "${member[@]}" "$one/api/me" | jq -r .me.isAdmin) == false ]] || fail "the member is an admin"
status=$(curl -sS -o /dev/null -w '%{http_code}' "${json[@]}" -b "$work/member.jar" -X PATCH -d '{"title":"Mine now"}' "$one/api/videos/$id")
[[ $status == 403 ]] || fail "a member edited the video of someone else: $status"
status=$(curl -sS -o /dev/null -w '%{http_code}' "${json[@]}" -d '{"email":"kim@example.com","displayName":"Kim","password":"a long password"}' "$one/api/join/$token")
[[ $status == 404 ]] || fail "an invitation worked twice: $status"

echo "Edit the library"
curl "${admin[@]}" -X PATCH -d '{"displayName":"E2E"}' "$one/api/me" >/dev/null
series=$(curl "${admin[@]}" -d '{"title":"E2E series","description":""}' "$two/api/series" | jq -r .series.id)
curl "${admin[@]}" -X PATCH -d "{\"seriesId\":\"$series\"}" "$one/api/videos/$id" >/dev/null
curl "${member[@]}" -d '{"body":"At 0:02 the parts meet."}' "$two/api/videos/$id/comments" >/dev/null
curl "${admin[@]}" -X PUT -d '{"stars":5}' "$one/api/videos/$id/rating" >/dev/null
curl "${member[@]}" -X PUT -d '{"stars":3}' "$two/api/videos/$id/rating" >/dev/null
[[ $(curl "${member[@]}" "$one/api/search?q=E2E" | jq -r '.videos[0].id') == "$id" ]] || fail "search did not find the video"
status=$(curl -sS -o /dev/null -w '%{http_code}' "${json[@]}" -b "$work/admin.jar" -H 'Sec-Fetch-Site: cross-site' \
  -d '{"title":"Spam","description":""}' "$one/api/series")
[[ $status == 403 ]] || fail "a change from another site answered $status"

check_library() {
  local base=$1
  curl "${admin[@]}" "$base/api/videos" | jq -e --arg id "$id" '.videos[0] | .id == $id and .series.title == "E2E series"
    and .ratingAverage == 4 and .ratingCount == 2 and .commentCount == 1 and .attachmentCount == 1 and .uploader.displayName == "E2E"' >/dev/null \
    || fail "the library is not as it was on $base: $(curl "${admin[@]}" "$base/api/videos" | jq -c '.videos[0]')"
}
check_library "$one"
check_library "$two"

echo "Restart both containers, then replace one, and keep the library and the sessions"
docker restart "$first" "$second" >/dev/null
wait_for "$one"
wait_for "$two"
check_library "$one"
check_library "$two"
docker stop "$first" >/dev/null
[[ $(docker inspect -f '{{.State.ExitCode}}' "$first") == 0 ]] || fail "albireo did not stop cleanly"
docker rm "$first" >/dev/null
start_albireo "$first" 8081
wait_for "$one"
check_library "$one"
# albireo writes a setup code only while it has nobody.
[[ -z $(docker logs "$first" 2>/dev/null | jq -R -r 'fromjson? | select(.setupCode != null) | .setupCode') ]] \
  || fail "albireo wrote a setup code although it has an admin"

echo "Remove the member, whose session ends and whose comment stays"
curl -fsS -b "$work/admin.jar" -X DELETE "$two/api/people/$member_id"
status=$(curl -sS -b "$work/member.jar" -o /dev/null -w '%{http_code}' "$one/api/me")
[[ $status == 401 ]] || fail "the session of a removed person answered $status"
status=$(curl -sS -o /dev/null -w '%{http_code}' "${json[@]}" -d '{"email":"sam@example.com","password":"a long password"}' "$one/api/sign-in")
[[ $status == 401 ]] || fail "a removed person signed in: $status"
check_library "$two"

echo "Delete the video with its files"
thumbnail_key=thumbnails/$id.jpg
attachment_key=attachments/$id/$(jq -r .attachment.id <<<"$attachment")
curl -fsS -b "$work/admin.jar" -X DELETE "$one/api/videos/$id"
for key in "videos/$id/original.mp4" "$thumbnail_key" "$attachment_key"; do
  if "${s3[@]}" head-object --bucket "$bucket" --key "$key" >/dev/null 2>&1; then fail "the bucket still holds $key"; fi
done
[[ $(curl "${admin[@]}" "$two/api/videos" | jq '.videos | length') == 0 ]] || fail "the video is still in the library"

echo "Check that the logs have no error"
for container in "$first" "$second"; do
  errors=$(docker logs "$container" 2>&1 | jq -R -c 'fromjson? | select(.level == "ERROR")')
  [[ -z $errors ]] || fail "$container logged errors: $errors"
done

passed=true
echo "PASS"
