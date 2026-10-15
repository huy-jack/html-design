# html-design

A Claude Code plugin that copies screens of your running web app into HTML design files. Claude then edits those files when you ask, and a local viewer shows every change live.

- You click through your real app, then press **Copy**. The current page becomes one *state* in a screen file.
- Each screen file holds all states of one screen. A toolbar picks the state, the width (1440 / 1024 / 375) and light or dark.
- You ask Claude for changes ("make the cards smaller"). Claude edits only the HTML, with your own tokens (Tailwind theme or CSS variables).
- You link buttons to states with a motion (fade, slide, morph) to show a flow.
- You click any element in the viewer and type a note. Then you say "do my notes".

Your app's code is never changed. The design files are plain HTML plus one CSS file, so they also open by double-click.

## Requirements

| Need | Version |
|---|---|
| Claude Code | with plugin support (`/plugin`) |
| Node.js | 20.11 or newer |
| npm | any recent version (setup uses it to install the browser) |
| Your app | runs locally (for example `http://localhost:3000`). Any CSS: Tailwind v4, Tailwind v3.3+, plain CSS, CSS modules or CSS-in-JS |
| Disk | about 550 MB once per machine (Playwright, Chromium, jsdom, prettier), plus about 30 MB for a project that is not Tailwind |

## Styles

| Style | Your app | How new styles are built |
|---|---|---|
| `tw4` | Tailwind v4 (`@import "tailwindcss"`) | Your own Tailwind, with your `@theme` tokens |
| `tw3` | Tailwind 3.3 or newer (`tailwind.config.js/.cjs/.mjs/.ts`) | Your own Tailwind 3 and config |
| `css` | Anything else | The plugin's own Tailwind 4.1.18. Classes start with `tw:` (`tw:p-6`), colors come from your CSS variables (`tw:bg-(--brand)`) |

Setup picks the style. `--style tw4|tw3|css` forces one.

## Install

The repo is public, so no login is needed to install it.

In Claude Code:

```
/plugin marketplace add huy-jack/html-design
/plugin install html-design@html-design
```

Restart Claude Code, or run `/reload-plugins`. The command `/html-design` is now available.

## Set up a project (once per project)

1. Install your app's own dependencies (`npm install`, `pnpm install`, ...). The CSS build reads your Tailwind file or config and the packages they import.
2. Start your app (`npm run dev`, ...).
3. In Claude Code, inside the project folder, run:

   ```
   /html-design setup
   ```

   Claude asks for the app address, for example `http://localhost:3000`.

What setup does:

1. Installs Playwright, Chromium, jsdom and prettier into the plugin's data folder (`~/.claude/plugins/data/<id>/`). This happens once per machine and takes 1 to 3 minutes. A project that is not Tailwind also gets the plugin's own Tailwind 4.1.18.
2. Picks the style: a Tailwind v4 file, else a Tailwind 3 config, else plain CSS.
3. Reads your dark-mode switch and your tokens (theme values or CSS variables).
4. Writes `design-mode.json` at the project root.
5. Creates the design folder (default `design/`).

When setup asks a question:

| Message | Meaning | What to do |
|---|---|---|
| "Several ..." (exit 4) | More than one Tailwind file, Tailwind config or Tailwind CSS file | Claude lists them; pick the app's main one |
| "design/ holds other files" (exit 5) | The folder name is taken | Pick another name, for example `design-2` |
| exit 6 | A package of your project is not installed | Install the project's dependencies, then run setup again. If the app no longer uses Tailwind, run setup with `--style css` |
| exit 7 | Tailwind 3 older than 3.3 | Upgrade Tailwind, or run setup with `--style css` |

Commit `design-mode.json` and the design folder if you want to share designs. The folder `design/.local/` is git-ignored (notes, logs, session data).

## Daily use

### 1. Start

```
/html-design start
```

This opens one browser window with your app, plus 2 local pages:

- **Viewer**: `http://127.0.0.1:<port>/`, the list of screen files.
- **Copy window**: `http://127.0.0.1:<port>/__copy`, the Copy controls.

The first time, log in to your app in that browser window. The login is saved in a profile inside the plugin's data folder (one per project), never in your project.

### 2. Copy states

1. In the app window, go to a page and click until it shows the state you want (an open menu, an error, an empty list).
2. In the Copy window, type the screen name (for example `Checkout`) and the state name (for example `empty`).
3. Press **Copy**. Or press **Ctrl+Shift+S** inside the app window: focus stays in the app, so open menus and hover states survive.

Rules:

- The first copy of a state sets the app window to the largest width first. That copy is the base.
- The same state at the same width asks "Replace?".
- The same state at another width (use the width buttons) is stored as a width copy, but only if the page differs.
- With 2 or more app tabs open, the Copy window asks which tab.

You can also ask Claude: "copy this as checkout empty".

### 3. Design with Claude

Ask in plain words. Examples:

- "make the cards in checkout smaller"
- "new state `error-long` from `error`, with a longer message"
- "the Save button goes to `saved`, slide-left, 300 ms"
- "do my notes" (after you used **Pick** in the viewer)

Claude follows these rules:

1. Only your tokens. In a css project only `tw:` classes and your CSS variables. No raw colors, no new `style="..."`, no `<style>` or `<script>`.
2. A token you need is missing: Claude uses the nearest one and tells you.
3. A change to a repeated part goes into every state, and Claude says how many.
4. Width copies change too, and Claude says which widths.
5. State ids are never removed or renamed (links point at them).
6. Animations show at rest.

After each edit Claude runs `/html-design check`. Undo is your own git.

### 4. Stop

```
/html-design stop
```

### All commands

| Command | Does |
|---|---|
| `/html-design setup` | Install and detect (see above) |
| `/html-design start` | Start the viewer, the app browser and the Copy window |
| `/html-design stop` | Stop all of them |
| `/html-design status` | Running or not, port, screen count, open notes, style |
| `/html-design tokens` | List the style, the class prefix and the tokens Claude may use |
| `/html-design check` | Find raw colors, new styles, scripts, broken links |

## The viewer

- **Home** (`http://127.0.0.1:<port>/`): every screen as a card with a live preview of its first state, its state count, open notes and last change. Search with `/`, sort by recent, name or state count.
- **A screen**: the states in a side list by group (filter at the top, a dot for open notes, a link count). The design shows at its true width (1440 / 1024 / 375) and is scaled down to fit the window, never up, so the app's breakpoints see the real width. Above it: the size, the zoom, and the page it was copied from.
- **Keys**: ↑ ↓ (or ← →) state, 1 2 3 width, D dark, P Pick.
- **Pick**: click an element and type a note.
- Linked buttons have a pointer. Click one to move to its state with its motion. Motion plays in Chrome 111+, Safari 18+ and Firefox 144+.
- A red bar shows a CSS build error. The last good CSS stays in use.
- A link to one state: `screens/<screen>.html#<state>@<width>`.
- **Copy window**: shows the app tab it will copy (pick one when several are open) and its width. **Copy state**, **Copy in 5 s**, or **Copy at 3 widths** (resizes the app tab and copies each width). **Recent** lists this session's copies with a preview.
- The viewer loads the Geist font from Google Fonts. Offline, it uses the system font.

## Config: `design-mode.json`

Setup writes it. You can edit it by hand.

| Key | Default | Meaning |
|---|---|---|
| `style` | detected | `tw4`, `tw3` or `css` |
| `dir` | `design` | The design folder |
| `css` | detected | Your Tailwind CSS file (tw4, tw3); `null` for css |
| `twConfig` | detected | tw3 only: your Tailwind config file |
| `themeVars` | detected | Theme variable names used to recognise your own CSS in the page |
| `tailwindVersion` | detected | Your Tailwind version, also used to recognise your own CSS |
| `dark` | `.dark` | How dark mode is switched: a class (`.dark`) or an attribute (`[data-theme=dark]`) |
| `widths` | `[1440, 1024, 375]` | Width buttons; the first one is the base width |
| `browser` | `chromium` | `chrome` uses your installed Chrome (for logins that refuse Chromium, such as some Google SSO) |
| `url` | asked | The page the app browser opens first |

After you change `css` or update Tailwind, run `/html-design setup` again.

## Scripting

While a session runs, `design/.local/session.json` holds `port` (the viewer), `cdpPort` (the browser's automation port, on 127.0.0.1 only), `version` and `pluginRoot`. A script of your own can drive the session browser and ask for copies:

1. Connect: `chromium.connectOverCDP('http://127.0.0.1:' + cdpPort)`, take `contexts()[0]`, open a page and bring it to the state you want.
2. Read the page's target id: `Target.getTargetInfo` on a CDP session for that page.
3. Copy: `POST http://127.0.0.1:<port>/__copy` with `{ "screen", "state", "label"?, "replace"?, "tab": "target:<id>" }`. 201 = saved, 409 = the state exists at this width, 400 = the tab is not open.
4. Close your pages before you disconnect. Disconnecting leaves them open.

Other hooks:

- An element with the attribute `data-hd-tool` is left out of every copy. Put it on your own dev-only overlays.
- Any `data-*` attribute you add on a state `<template>` is kept on every rewrite.
- `node <pluginRoot>/scripts/build-css.mjs --screens <dir> --out <file>` builds CSS for another folder of screen files.

While a session runs, any program on this computer, from any user account, can fully control the session browser through the automation port, including the sites you logged in to there. Web pages cannot reach it: Chromium refuses connections from other origins. Do not run a session on a shared computer.

## What lands in your project

```
design-mode.json
design/
  screens/<screen>.html   one file per screen, one <template> per state
  assets/                 images and other files, named by a hash of their content
  design.css              entry for tw4; a comment for tw3 and css
  dist/design.css         built CSS (rebuilt on every change)
  fonts.css               fonts from your app, embedded as base64
  page.css                library CSS copied from your app, stored once
  switcher.js             the viewer toolbar (refreshed on each start)
  README.md               how to read the files
  .local/                 git-ignored: notes, session file, logs
```

## Limits

- Not copied: content inside shadow DOM, iframes, `<canvas>` drawings, video frames (a `<video>` with a poster image becomes that image). The Copy window warns about each one.
- `page.css` only grows. CSS from a library you removed stays in it. Check warns when it is over 10 MB.
- An image set by `url()` inside your own Tailwind file is not downloaded, so it is blank offline.
- Screen files over 25 MB get a warning.
- Windows is untested. The session check needs `ps`.
- In a css project, an inline `style="... !important"` on an element beats a `tw:` class.
- Tailwind 3 `darkMode: "media"` is rebuilt as the class `.dark`, so the Dark button works.
- Tailwind 3: your PostCSS config is not run.
- Copy from your dev server: a production bundle that merges Tailwind with other CSS loses the other CSS.

## Troubleshooting

| Problem | Fix |
|---|---|
| `start` says "Run /html-design setup again" | Setup is missing, or the plugin updated its browser version. Run setup |
| `start` says it did not start within 45 s | Read `design/.local/session.log` |
| The copy has the wrong fonts | Run the copy again with the page fully loaded. Fonts come from the page at copy time |
| "No app page is open" (503) | Open your app in the session browser window, not in your normal browser |
| A login page refuses the browser | Set `"browser": "chrome"` in `design-mode.json`, then `/html-design stop` and `start` |
| Red bar in the viewer | Your CSS file has an error, or a package it imports is missing. The bar shows the message |

## Development

```
git clone https://github.com/huy-jack/html-design
cd html-design
npm install
npx playwright install chromium
npm test                                # 250 tests; the first run installs a Tailwind 3 test app (about 25 MB, needs the network)
claude --plugin-dir ./plugin            # use the local copy in Claude Code
claude plugin validate ./plugin
```

- `plugin/` is the only folder users install. It has no `package.json`: runtime packages load from the project or from the plugin data folder.
- Tests live in `test/`. A fixture app with a login, images and fonts behind the login is in `test/fixture/`.


## License

MIT. See [LICENSE](LICENSE).
