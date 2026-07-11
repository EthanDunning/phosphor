# PHOSPHOR
### A retro terminal simulator for tabletop role-playing games

This is a fork of [redhg's original Phosphor project](https://github.com/redhg/phosphor). The original was built as a bespoke terminal prop for the [Mothership RPG](https://www.mothershiprpg.com/) module [The Haunting of Ypsilon 14](https://www.mothershiprpg.com/pamphlet-adventures/#The_Haunting_Of_Ypsilon_14), inspired by [Quadra's post](https://www.traaa.sh/the-ypsilon-14-terminal) about running that scenario. This fork expands on the original to make the tool more useful for anyone who wants to run their own terminal prop, without needing to edit source code.

Pull requests and issues are welcome.

[View the terminal in action here.](https://dunninganddragons.com/phosphor/)

---

## What's new in this fork

The original project loaded a single hardcoded JSON file (sample.json by default), had no audio, and required editing source code to change anything. This fork adds:

**Content & scripts**
- **Script selector** — a toolbar at the top of the page lets you switch between bundled scripts or upload your own JSON without touching any code.
- **JSON upload** — load any Phosphor-compatible `.json` file directly in the browser at runtime. No build step required as long as assets are hosted externally.
- **INCR-SS-ARK scenario** — a full original scenario bundled alongside the existing Ypsilon-14 and Sample scripts, selectable from the toolbar.
- **Terminal script system** (`src/scripts/terminal/`) — an optional JavaScript/TypeScript layer that can be attached to a JSON scenario to drive dynamic runtime behavior (state tracking, timed events, conditional UI changes, etc.). Used by INCR-SS-ARK.

**New element types**
- **`list`** — a multi-state cycling element similar to `toggle` but designed for ordered item selection.
- **`dropdown`** — a multi-state element similar to `toggle`, but clicking it expands an inline list of all states so one can be picked directly instead of cycling through them.
- **`reportcomposer`** — a freeform text input that saves entries to localStorage and renders them as links on a target screen.
- **`href`** — a link type that opens an external URL in a new tab instead of navigating within the terminal.
- **`loop`** — a property on any object element that repeats it N times, avoiding repetition in the JSON.
- **`onDone`** — a screen property that automatically advances to a target screen after the current one finishes rendering, with an optional delay.
- **`speed`** — per-element control over the teletype animation speed.
- **`fillWidth`** and **`animated`** — additional bitmap display options.
- **`allowFreeInput`** and **`inputAction`** — prompt options for accepting arbitrary text rather than a fixed command list.

**Audio**
- **Sound effects** — CRT power-on/off tones, ambient transformer hum, and randomized mechanical typing sounds play during terminal interaction. Autoplay is triggered on first user interaction to comply with browser policies.

**Terminal interfaces**
- **`filesystem` screen type** — a new screen `type` (alongside `screen` and `static`, and selectable in the Script Creator) that reproduces the SEEGSON data terminals from *Alien: Isolation*: a solid title bar around a framed CRT viewport, and a three-region **folders → sub-sections → content** layout that updates in place with no screen transitions (arrow keys and mouse both work). Set a screen's type to make it a file browser; no global toggle needed. `config.terminalType: "alien"` optionally wraps every screen in the same chrome. See the bundled **ALIEN TERMINAL (SEEGSON)** script for a full example. The system is pluggable, so additional interface skins can be added over time.

**Themes & UI**
- **Color themes** — cycle between four CRT color presets (Blue, Amber, Green, White) using the toolbar. Your choice is saved across sessions.
- **Cloudflare Workers deployment** — `wrangler.toml` and `worker.js` are included for deploying to Cloudflare Pages/Workers via `npm run deploy:worker`.

---

## Using Phosphor

When you open the app you'll see a small toolbar fixed to the top of the screen with three controls:

- **`[SCRIPT:...▼]`** — click to open a dropdown listing the bundled scripts. Select one to load it, or choose `[ UPLOAD JSON ]` at the bottom of the dropdown to load a JSON file from your computer.
- **`[THEME:...]`** — click to cycle through the four color themes.
- **`[GITHUB]`** — links to this repository.

The terminal itself works the same as the original: click links to navigate between screens, use `Shift+Space` to skip the teletype animation on the current screen, `Ctrl+Shift+L` to bypass a login screen (it submits the login's first credential), and `Shift+H` to show/hide the header. Shortcuts are ignored while text is being entered, so they never interfere with typing in a prompt, login, or text field. The bundled **PHOSPHOR SAMPLE SCRIPT** has a **KEYBOARD SHORTCUTS** page listing all of them.

### Writing your own script

Scripts are JSON files. See `src/data/sample.json` for a commented walkthrough of all supported element types (text, links, bitmaps, prompts, toggles, lists, dialogs, and more).

The top-level structure is:

```json
{
    "config": {
        "name": "My Script",
        "script": "optional-custom-script-id"
    },
    "screens": [ ... ],
    "dialogs": [ ... ]
}
```

Each screen has an `id`, a `type` (`"screen"` or `"static"`), and a `content` array of elements. Links between screens use the target screen's `id`. Images can reference any public URL or a path relative to the deployment's `public/` folder.

#### Screen types and the *Alien: Isolation* file system

Every screen has a `type` that decides how it is interpreted. Alongside the classic `"screen"` (teletype) and `"static"`, there is now **`"filesystem"`** — a screen that renders the SEEGSON three-region file browser from *Alien: Isolation*. Pick it from the **Type** dropdown in the Script Creator, or set it in JSON:

```json
{ "id": "main", "type": "filesystem", "headerTitle": "PERSONAL TERMINAL", "content": [ … ] }
```

A `filesystem` screen brings its own chrome: a solid title bar (from the screen's `headerTitle`, falling back to `config.name`) over a framed CRT viewport that fills the window with a uniform edge margin (the scanlines and vignette render over the title bar too). It respects whatever color theme is active. The rest of your screens (boot sequence, login, etc.) stay classic `"screen"`/`"static"` — the type is what flips a screen into the browser, so there's nothing hidden to toggle.

The `filesystem` screen is a self-contained terminal with **no screen transitions**:

- its `link` elements become the **folder tabs** down the left;
- the selected folder's **target screen** supplies the **sub-section list** shown top-right — those are the target's own `link` elements, or, if the target has no links, the target itself is treated as a single sub-section (its `title` becomes the label);
- if the target screen *also* has non-link content (text, etc.) alongside its links, that content is surfaced as a leading **file named after the folder**, so nothing is hidden — this makes converting an old text+links screen into a file system painless;
- links that point **back to the file-system screen itself** (the old `< BACK` buttons on converted screens) are dropped, so they don't clutter the file list;
- the selected sub-section's target supplies the **content** shown in the body below. That content is rendered with the same element components as a classic screen, so it supports text **class names** (`alert`/`notice`/`system`/…), **markdown**, **images** (`bitmap`), and interactive elements — not just plain text.

Give leaf/content screens a `title` to label them in the list. Navigate with the arrow keys (`↑/↓` move within the focused list; `←/→` move from the folder list into the sub-section list; `Enter` opens/activates; `Home`/`End` jump to the ends; `Backspace` returns focus from the sub-section list to the folder list), or just click any folder or sub-section.

> To wrap **every** screen (including classic ones) in the same chrome, set `config.terminalType: "alien"` — then classic screens teletype inside the CRT frame too. The `"filesystem"` screen type does not require it. (`layout: "folders"` on a `"screen"` is still honored as a legacy alias for `"filesystem"`.)

**Working buttons.** A folder or sub-section that should *do something* (navigate, run an action) rather than open content is written as a **button** — give its `link` the array `target` form used by classic links, and it will fire through `_handleLinkClick` when clicked or `Enter`ed. For example, a log-out/back control:

```json
{ "type": "link", "text": "‹ LOG OUT", "target": [ { "type": "action", "action": "back" } ] }
```

(A plain string `target` opens content; an array `target` is a button.) Screens **without** `layout: "folders"` (boot screens, login prompts, etc.) render with the normal teletype flow inside the same chrome. See `src/data/alien-terminal.json` for a complete, playable example.

To load your script without a build step, upload the JSON using the toolbar's `[ UPLOAD JSON ]` option. Any images or other assets you reference should be hosted externally (e.g. on Imgur, a CDN, or your own server) so they resolve correctly in the browser.

To bundle your script into the app permanently (so it appears in the dropdown alongside the built-in ones), add your JSON to `src/data/`, import it in `src/data/index.ts`, and add an entry to `BUNDLED_SCRIPTS`.

---

## Getting Started

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

To install, open a terminal in the repo directory and run:

```
npm install
```

## Available Scripts

### `npm start`

Runs the app in development mode with Vite. Open the local URL printed in the terminal (typically [http://localhost:3000](http://localhost:3000)). The page reloads on edits.

### `npm run build`

Builds the app for production to the `build/` folder.

### `npm test`

No automated tests are currently configured.

### `npm run preview`

Serves the production build locally for quick verification.

## Learn More

- [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started)
- [React documentation](https://reactjs.org/)
