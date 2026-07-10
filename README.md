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
- **Terminal types** — a script can choose an *interface skin* via `config.terminalType`. The default (`"classic"`) is the original free-scrolling teletype. `"alien"` reproduces the SEEGSON data terminals from *Alien: Isolation*: a solid title bar around a framed CRT viewport, and a three-region **folders → sub-sections → content** layout that updates in place with no screen transitions (arrow keys and mouse both work). See the bundled **ALIEN TERMINAL (SEEGSON)** script for a full example. The system is pluggable, so additional interface skins can be added over time.

**Themes & UI**
- **Color themes** — cycle between four CRT color presets (Blue, Amber, Green, White) using the toolbar. Your choice is saved across sessions.
- **Cloudflare Workers deployment** — `wrangler.toml` and `worker.js` are included for deploying to Cloudflare Pages/Workers via `npm run deploy:worker`.

---

## Using Phosphor

When you open the app you'll see a small toolbar fixed to the top of the screen with three controls:

- **`[SCRIPT:...▼]`** — click to open a dropdown listing the bundled scripts. Select one to load it, or choose `[ UPLOAD JSON ]` at the bottom of the dropdown to load a JSON file from your computer.
- **`[THEME:...]`** — click to cycle through the four color themes.
- **`[GITHUB]`** — links to this repository.

The terminal itself works the same as the original: click links to navigate between screens, use `Shift+Space` to skip the teletype animation on the current screen.

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

#### Terminal interface (terminal type)

By default a script uses the classic Phosphor presentation. To use the *Alien: Isolation*-style interface, set `config.terminalType` to `"alien"` and (optionally) provide an `alien` block:

```json
{
    "config": {
        "name": "My Terminal",
        "terminalType": "alien",
        "alien": {
            "title": "PERSONAL TERMINAL"
        }
    }
}
```

The `alien` skin renders a solid title bar (with a Back button that returns to the previous screen) around a framed CRT viewport that fills the window with a uniform edge margin. `config.alien.title` sets the header text; an individual screen can override it with its own `headerTitle` (editable in the Script Creator's per-screen `[CONTROLS]` panel). Both fall back to `config.name`. The skin respects whatever color theme is active, so it looks right in Blue, Amber, Green, or White.

**Folders view (`layout: "folders"`).** A screen opts into the SEEGSON three-region layout by setting `"layout": "folders"`. It becomes a single self-contained terminal with **no screen transitions**:

- its `link` elements become the **folder tabs** down the left;
- the selected folder's **target screen** supplies the **sub-section list** shown top-right — those are the target's own `link` elements, or, if the target has no links, the target itself is treated as a single sub-section (its `title` becomes the label);
- the selected sub-section's target supplies the **content** typed into the body below.

Give leaf/content screens a `title` to label them in the list. Navigate with the arrow keys (`↑/↓` move within the focused list; `←/→` or `Enter` move from the folder list into the sub-section list; `Home`/`End` jump to the ends), or just click any folder or sub-section. From the sub-section list, `Backspace` returns focus to the folder list; from the folder list, `Backspace` (or the header's Back button) steps back out of the terminal. Screens **without** `layout: "folders"` (boot screens, login prompts, etc.) render with the normal teletype flow inside the same chrome. See `src/data/alien-terminal.json` for a complete, playable example.

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
