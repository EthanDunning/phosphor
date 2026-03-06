# PHOSPHOR
### A retro terminal simulator for tabletop role-playing games

This is a fork of [redhg's original Phosphor project](https://github.com/redhg/phosphor). The original was built as a bespoke terminal prop for the [Mothership RPG](https://www.mothershiprpg.com/) module [The Haunting of Ypsilon 14](https://www.mothershiprpg.com/pamphlet-adventures/#The_Haunting_Of_Ypsilon_14), inspired by [Quadra's post](https://www.traaa.sh/the-ypsilon-14-terminal) about running that scenario. This fork expands on the original to make the tool more useful for anyone who wants to run their own terminal prop, without needing to edit source code.

Pull requests and issues are welcome.

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
- **`reportcomposer`** — a freeform text input that saves entries to localStorage and renders them as links on a target screen.
- **`href`** — a link type that opens an external URL in a new tab instead of navigating within the terminal.
- **`loop`** — a property on any object element that repeats it N times, avoiding repetition in the JSON.
- **`onDone`** — a screen property that automatically advances to a target screen after the current one finishes rendering, with an optional delay.
- **`speed`** — per-element control over the teletype animation speed.
- **`fillWidth`** and **`animated`** — additional bitmap display options.
- **`allowFreeInput`** and **`inputAction`** — prompt options for accepting arbitrary text rather than a fixed command list.

**Audio**
- **Sound effects** — CRT power-on/off tones, ambient transformer hum, and randomized mechanical typing sounds play during terminal interaction. Autoplay is triggered on first user interaction to comply with browser policies.

**Themes & UI**
- **Color themes** — cycle between four CRT color presets (Blue, Amber, Green, White) using the toolbar. Your choice is saved across sessions.
- **Cloudflare Workers deployment** — `wrangler.toml` and `worker.js` are included for deploying to Cloudflare Pages/Workers via `npm run deploy:worker`.

---

## Using Phosphor

When you open the app you'll see a small toolbar fixed to the top of the screen with three controls:

- **`[ SCRIPT: ... ▼ ]`** — click to open a dropdown listing the bundled scripts. Select one to load it, or choose `[ UPLOAD JSON ]` at the bottom of the dropdown to load a JSON file from your computer.
- **`[ THEME: ... → ]`** — click to cycle through the four color themes.
- **`[ GITHUB ]`** — links to this repository.

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

### `yarn start`

Runs the app in development mode. Open [http://localhost:3000](http://localhost:3000) to view it in the browser. The page reloads on edits.

### `yarn build`

Builds the app for production to the `build/` folder.

### `yarn test`

Launches the test runner. Note: there are currently no tests in this project.

### `yarn eject`

**One-way operation — cannot be undone.** Ejects from Create React App, copying all build config into the project for full manual control.

## Learn More

- [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started)
- [React documentation](https://reactjs.org/)
