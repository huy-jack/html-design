# Design files

Each file in `screens/` is one screen of the app. It holds every state of that screen.

## Open a screen

- Double-click the file, or open it through the view server (it rebuilds the CSS first and reloads after each save).
- The toolbar picks the state, the width (1440, 1024, 375) and light or dark.
- A link to one state at one width: `screens/<screen>.html#<state>@375`.
- With the view server: **Previous / Next** (or the arrow keys) step through the states; **See it live** opens the real app at the same state (look only; a hint names any click the app needs); **Pick** lets you click an element and type a note. Say "do my notes" to Claude to apply them.
- Double-clicked files keep the state list, widths, theme, Previous / Next and the links with their motion. See it live, Pick and the note count need the view server.

## What a state means

- **No badge:** the real app must look like this state. QA compares layout, spacing, colors, fonts and which elements show. QA does not compare exact text and images: the real app uses real data, the files use fake data.
- `data-url` on a state is the app page it was copied from. `data-source` is the code line that renders it.

## Classes in a css project

When `design-mode.json` says `"style": "css"`, new styles are classes that start with `tw:`, for example `tw:p-6` or `tw:bg-(--brand)`. html-design builds them with its own Tailwind into `dist/design.css`. Your app's own classes still come from `page.css`.

## Links and motion

- A linked button has a pointer cursor. Click it to move to the linked state with its motion. Click anything else to flash every linked button.
- Motions: `none`, `fade`, `slide-left`, `slide-right`, `slide-up`, `morph` (an element with the same `data-morph` name in both states moves and resizes). They play in Chrome 111+, Safari 18+ and Firefox 144+; other browsers swap with no motion.
- The bar warns when a link's button is gone and when a link names a state that does not exist.

## Limits

- `page.css` only grows.
- `url()` images inside your own Tailwind file are not downloaded.
- Shadow DOM, iframes, canvas and video are not copied.
- A local plugin test and a marketplace install use different data folders, so run setup again after installing from the marketplace.
- Never edit `dist/` or `fonts.css` by hand.
