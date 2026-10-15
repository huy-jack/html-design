---
name: html-design
description: Use when the user wants to copy screens of their running web app into HTML design files, change those designs, link states with motion, apply Pick notes, or view designs (e.g. "/html-design setup", "/html-design start", "copy this as checkout empty", "make the cards smaller", "do my notes").
---

# html-design

Design files live in `<dir>/screens/` (`dir` is set in `design-mode.json`, default `design`). One file per screen, one `<template>` per state. Run every script from the project root. Every script needs `--data "${CLAUDE_PLUGIN_DATA}"` on every call, written out in the command: the scripts load their packages from that folder, and the variable is not set in the shell.

## Commands
| User says | Run |
|---|---|
| `/html-design setup` | Ask for the app address. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" --url <address> --data "${CLAUDE_PLUGIN_DATA}"`. Exit 4: several Tailwind files; list them, ask which, rerun with `--css <file>`. Exit 5: the folder holds other files; ask a folder name, rerun with `--dir <name>`. Exit 6: tell the user to install the project dependencies, then rerun. Last output line is JSON; if `viewOnly` is true, say so (new classes will not render). |
| `/html-design start` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/session.mjs" start --data "${CLAUDE_PLUGIN_DATA}"`. Give both addresses it prints (Viewer, Copy window). It prints them only once the session browser is open, so a copy can follow at once. Exit 6: setup is missing or old; offer `/html-design setup`. |
| `/html-design stop` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/session.mjs" stop --data "${CLAUDE_PLUGIN_DATA}"` |
| `/html-design status` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/session.mjs" status --data "${CLAUDE_PLUGIN_DATA}"`. Prints JSON: `running`, `port`, `screens`, `openNotes`. |
| `/html-design check` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs" --data "${CLAUDE_PLUGIN_DATA}"`. Each line is `<file>#<state>: <rule> <value>`. Explain each finding. Exit 1 means problems. |
| "copy this as <screen> <state>" | Get the port from `session.mjs status`. Run `curl -s -X POST -H 'content-type: application/json' --data '{"screen":"<screen>","state":"<state>"}' http://127.0.0.1:<port>/__copy`. 201: report `saved`, `images` and any `warnings`. 409 with `tabs` (a list of `{ "id": "t-1", "title": "..." }`): ask which by title, resend with `"tab": "<id>"` (an id stays with its tab; 400 means that tab closed, so copy again). 409 with `exists`: ask "Replace?", resend with `"replace": true`. 503: no app page is open; ask the user to open the app in the session browser. 500 with `error`: the copy itself failed (for example the page navigated away during the copy); show `error` and ask the user to retry once the page is still. 400: show `error`. |
| a design change | Edit under the rules below, then run the check command above (with `--data`). |
| "new state <id> from <state>" | Copy that `<template>` block under the new id, then edit it. |
| "<button> goes to <state>, <motion>, <ms>" | `node "${CLAUDE_PLUGIN_ROOT}/scripts/links.mjs" add --screen <s> --from <state> --button "<text>" --to <state or screen#state> --motion <motion> --ms <ms> --data "${CLAUDE_PLUGIN_DATA}"`. Motion is one of none, fade, slide-left, slide-right, slide-up, morph. Optional: `--nth <n>` when several buttons share the text; `--morph a,b` for morph. Never edit the links block by hand. |
| "show my links" | `node "${CLAUDE_PLUGIN_ROOT}/scripts/links.mjs" list --screen <s> --data "${CLAUDE_PLUGIN_DATA}"` |
| "remove link N" | `node "${CLAUDE_PLUGIN_ROOT}/scripts/links.mjs" remove --screen <s> --index <N> --data "${CLAUDE_PLUGIN_DATA}"` (N is the number `list` prints) |
| "do my notes" | `node "${CLAUDE_PLUGIN_ROOT}/scripts/notes.mjs" list --data "${CLAUDE_PLUGIN_DATA}"`. Each line ends with a status label: `[ok]` and `[moved]` give the element; edit it in its state block. `[ambiguous xN]`, `[missing]`, `[no-block]`, `[no-screen]`: ask the user about it, quoting the note. After applying a note run `notes.mjs done <id> --data "${CLAUDE_PLUGIN_DATA}"`. If an edit is undone, run `notes.mjs reopen <id> --data "${CLAUDE_PLUGIN_DATA}"`. |

## Edit rules
1. Only classes from the project's `@theme` tokens. Never raw colors (`text-[#...]`), new `style="..."`, `<style>` or `<script>`. View-only mode: only classes already in the file.
2. Missing token: use the nearest one and tell the user what is missing.
3. Repeated part: change it in every state; say how many.
4. Change width copies (`data-variant-of`) too where the part exists; say which widths.
5. Never remove or rename a state id.
6. Animations show at rest.

After every edit run the check command (with `--data`).

## Large files
Files reach 25 MB. Find the state with `grep -n 'id="<state>"'`, read only that block, edit it there.

Undo is the user's own git.
