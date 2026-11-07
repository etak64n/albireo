---
title: "Releases"
description: "Versions, release notes, and how to publish a release."
---

The version of albireo is `version` in package.json, and each release is a tag with that version, such as v0.2.0.
The notes of a release say what changed and what a deployment must change.
Until version 1.0.0, a minor version, such as 0.2.0, may need changes to the settings or the deployment, and a patch version, such as 0.2.1, needs none.

To publish a version, set `version` in package.json, commit, and push an annotated tag whose message holds the notes of the release.

```bash
# Tag the commit that sets "version" to 0.2.0, with the notes of the release in notes.md.
# --cleanup=verbatim keeps every line: by default, git drops lines that start with #.
git tag -a v0.2.0 -F notes.md --cleanup=verbatim

# Push the commit and the tag
git push origin main v0.2.0
```

The tag starts the Release workflow (.github/workflows/release.yml).
It runs the checks of CI, stops if the tag has no message or names another version than package.json, and publishes the release with the message of the tag as its notes.
