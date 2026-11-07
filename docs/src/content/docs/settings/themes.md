---
title: "Themes"
description: "The colors, corners, shadows, fonts, and logo of the library."
---

A theme is a folder with two files: theme.css for the colors, corners, shadows, and fonts, and logo.svg for the logo.
`appearance.theme` names the folder, and albireo includes `./themes/light` and `./themes/dark`.

theme.css sets these variables, and src/styles.css turns them into the styles of the app.

- Accent: `--theme-accent`, `--theme-accent-hover`, `--theme-accent-subtle`, `--theme-on-accent`, and `--theme-focus-ring`
- Text: `--theme-text-heading`, `--theme-text-strong`, `--theme-text-control`, `--theme-text`, `--theme-text-label`, `--theme-text-subdued`, and `--theme-text-placeholder`
- Surfaces and lines: `--theme-surface`, `--theme-surface-subdued`, `--theme-surface-hover`, `--theme-border`, and `--theme-hairline`
- Status: `--theme-positive` and `--theme-critical`
- Labels over pictures and the shade under dialogs: `--theme-overlay`, `--theme-on-overlay`, and `--theme-scrim`
- Corners: `--theme-radius-xs`, `--theme-radius-sm`, `--theme-radius-md`, `--theme-radius-lg`, and `--theme-radius-xl`
- Shadows of what floats over the page: `--theme-shadow-tooltip` and `--theme-shadow-popover`
- Fonts: `--theme-font` and `--theme-font-mono`

The logo also becomes the favicon (src/main.tsx).
When either file is missing, `cf dev` and the build stop with an error, so a typo in the path does not ship an unstyled library (vite.config.ts).

To make a theme of your own, copy themes/light to a folder of yours, change the values and the logo, and point `appearance.theme` at the folder.
