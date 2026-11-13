---
title: "Releases"
description: "Versions, images, release notes, and how to publish a release."
---

The version of albireo is `version` in package.json, and each release is a tag with that version, such as v0.2.0.
Each release publishes the image to ghcr.io/etak64n/albireo, for amd64 and arm64, under three tags: the version, such as 0.2.0, its minor version, such as 0.2, and latest.

- An image of a minor version, such as 0.2, follows the fixes of that version.
- latest follows every release, the ones that need a change of the settings included.

The notes of a release say what changed and what a deployment must change.
Until version 1.0.0, a minor version, such as 0.2.0, may need changes to the settings, and a patch version, such as 0.2.1, needs none.

To publish a version, set `version` in package.json and the tag of the image in compose.yaml, commit, and push an annotated tag whose message holds the notes of the release.

```bash
# Tag the commit that sets "version" to 0.2.0, with the notes of the release in notes.md.
# --cleanup=verbatim keeps every line: by default, git drops lines that start with #.
git tag -a v0.2.0 -F notes.md --cleanup=verbatim

# Push the commit and the tag
git push origin main v0.2.0
```

The tag starts the Release workflow (.github/workflows/release.yml).

1. It stops if the tag names another version than package.json.
2. It builds the image for each architecture on a runner of that architecture, pushes it by its digest, and runs test/e2e.sh against it.
3. It joins the images that passed under the tags of the version.
4. It stops if the tag has no message, and publishes the GitHub release with the message of the tag as its notes.
