# PHOSPHOR v10.0
### A retro terminal simulator for tabletop role-playing games

Phosphor turns a browser into an in-world computer terminal for your players: CRT glow, scanlines, typing sounds, logins, file systems, databases and hidden secrets, all driven by a JSON **module** you can write without touching code.

This is a fork of [redhg's original Phosphor project](https://github.com/redhg/phosphor), which was built as a terminal prop for the [Mothership RPG](https://www.mothershiprpg.com/) module [The Haunting of Ypsilon 14](https://www.mothershiprpg.com/pamphlet-adventures/#The_Haunting_Of_Ypsilon_14), inspired by [Quadra's post](https://www.traaa.sh/the-ypsilon-14-terminal) about running that scenario. This fork turns it into a general-purpose tool: a visual Module Creator, an online module library, accounts, and many new element types.

**[Try it here.](https://dunninganddragons.com/phosphor/)** Pull requests and issues are welcome; you can also send bug reports and feature requests from inside the app (**SUPPORT > FEEDBACK**).

---

## What's new in v10.0

**Everything is a module.** What used to be called a "script" is now a **module**, whether it's built in, saved only in your browser, or published to the Library. The header reads **MODULE** (pick one) and **MY MODULES** (manage them), and the editor is the **Module Creator**.

**Terminal and modules**
- **Data tables.** A new `table` element prints a box-drawn database grid, then becomes a record browser you can move through, sort, search and page. The Module Creator edits tables in a spreadsheet-style grid.
- **Class names combine.** `"alert small center"` now works. In the Module Creator each class is a removable chip, and color classes show their color, e.g. *alert (red)*. A new color or blend mode replaces the old one; layout classes stack.
- **Custom colors.** Name your own color classes (`"toxic": "#88ff00"`) in the module config, or create one from the class picker. Every element can then use it like `alert`.
- **Font sizes.** Set text size in points per element (`fontSize`), or as a default for a screen, a dialog or the whole module (`defaultFontSize`). In the Creator, Text Align, Text Speed and Font Size share one row.
- **Images reworked.** Blend modes now work as intended, with a `background` plate so the darkening modes stay visible on dark themes. Images also support alignment and a `footer` class (space above), and dialog images use the same classes.
- **File-system screens.** Links and table rows inside a file now open their target in place instead of leaving the file browser.
- **YPSILON-14 FILE SYSTEM.** *The Haunting of Ypsilon-14* rebuilt on the file-system screen: the same station data as folders, files and sortable tables. It replaces the old *Alien: Isolation* demo.
- **Phones and tablets.** Tapping a prompt, login or table search line opens the on-screen keyboard; tapping anywhere else closes it.
- **Sample module.** The built-in **PHOSPHOR SAMPLE MODULE** now has a working example of every feature, including a page on what's new.

**Library and accounts**
- **Web View** is a new, modern library layout and the default. **Terminal View** is the retro layout, renamed from Retro View. Each view uses its matching font.
- **Usernames.** Every account gets a random, unique username. On first sign-in you choose to keep it or pick your own, and you can change it any time under **PROFILE**. Modules show as "By *username*".
- **Co-authors.** Credit other creators on a module by pasting their account ID; each person copies their own ID from **PROFILE**. Nobody can browse or search other users' names, so the app never reveals who has an account.
- **Ratings.** Ratings show as stars, and you can now remove your rating.
- **Show in Menu.** Your choice of which modules appear in the MODULE menu is saved to your account, so it follows you across devices and no longer resets.

**App**
- **SUPPORT > HELP** opens a window listing every keyboard shortcut.
- **MODULE > + NEW MODULE** starts an empty module saved in your browser and opens it in the Creator.
- Opening a shared module link no longer flashes the default module while it loads.

**Feedback**
- A **SUPPORT** menu groups Help, Feedback, Donate, GitHub and (for admins) the Admin Panel.
- **FEEDBACK** sends a bug report, feature request or general feedback. **MY FEEDBACK** shows each message's status and any reply. A badge appears when an admin replies.
- Admins get an inbox to filter, update the status of, reply to and delete feedback.

**Under the hood**
- **Security hardening:**
  - safer link and markdown handling against XSS and ReDoS
  - CSP and HSTS headers
  - tighter Supabase row-level security
  - private profiles
  - rate-limited feedback
- **Performance and maintenance:** faster loading (code splitting, a lighter ambient-audio file, font loading fixes) and updated dependencies.

---

## Using Phosphor

### The header

| Control | What it does |
|---|---|
| **MODULE** | Switch between built-in modules, your own and ones you've subscribed to. Also **UPLOAD JSON** and **+ NEW MODULE**. |
| **CREATOR** | Open the Module Creator to edit the active module. |
| **MY MODULES** | Your modules and subscriptions. Choose which ones appear in the MODULE menu (**Show in Menu**). |
| **LIBRARY** | Browse, search, rate and subscribe to published modules. |
| **OPTIONS** | Sound, header visibility, print, reload, clear local data, reset, and color theme. |
| **SUPPORT** | Help (every keyboard shortcut), feedback, donate, GitHub, and the Admin Panel for admins. |
| **SIGN IN / PROFILE** | Google sign-in. PROFILE shows your username (editable) and account ID. |

On narrow screens these controls fold into a **MENU** button.

**Themes:** Blue, Amber, Green, White, Light, or a module-defined custom palette.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Shift` + `Space` | Skip the typing animation on the current screen |
| `Shift` + `H` | Show / hide the header |
| `Ctrl` + `Shift` + `L` | Bypass a login (submits its first credential) |
| `Shift` + click, or press-and-hold | The alternate action on a link, toggle or list, where the module defines one |

Shortcuts are ignored while you're typing in a prompt, login or text field. File-system screens and data tables have their own arrow-key navigation; **SUPPORT > HELP** (or the sample module's **KEYBOARD SHORTCUTS** page) lists everything.

### Built-in modules

- **PHOSPHOR SAMPLE MODULE:** an interactive manual with a live example of every element and option. Start here.
- **YPSILON-14 FILE SYSTEM:** the same Ypsilon-14 station as a file-system terminal. Items marked [A] are admin-only; the Warden can **Shift+click** (or Shift+Enter) them to open the administrator node.
- **YPSILON-14:** the original terminal from *The Haunting of Ypsilon 14*.

---

## Modules and the Library

Modules start out saved in your browser. Sign in with Google to publish them online:

- **Visibility.** `private` modules are yours only. `unlisted` modules open by direct link. `public` modules appear in the Library.
- **Library.** Search, sort, subscribe and rate modules (1–5 stars; you can remove your rating). Switch between **Web View** and **Terminal View** under **OPTIONS**.
- **Credits.** Modules show "By *username*" plus any co-authors. To add a co-author, open **MODULES > Manage > Edit Details** and paste their full account ID. Co-authors can remove themselves.
- **Show in Menu.** In the MY MODULES panel, decide which of your modules and subscriptions appear in the MODULE menu. The choice is saved to your account.

---

## Writing your own module

Modules are JSON. You can write them by hand or build them in the **Module Creator** (header > CREATOR, or **MODULE > + NEW MODULE** to start fresh), which shows every element type as a form and offers a live **PREVIEW** in the real renderer. The sample module (`src/data/sample.json`) is the best reference: every page explains a feature and demonstrates it.

```json
{
    "config": { "name": "My Module", "author": "You", "theme": "amber" },
    "screens": [
        { "id": "start", "type": "screen", "content": [
            "Hello, crew.",
            { "type": "link", "text": "> OPEN LOG", "target": "log" }
        ] },
        { "id": "log", "type": "static", "content": ["Nothing to report."] }
    ],
    "dialogs": []
}
```

### Config

| Key | Purpose |
|---|---|
| `name`, `author` | Shown in the header and the Library |
| `theme` | `blue`, `amber`, `green`, `white`, `light` or `custom` |
| `customTheme` | Colors used when `theme` is `custom` (`bgHex`, `fgHex`, `textHex`, `alertHex`, `noticeHex`, `emphasisHex`, `systemHex`, `hyperlinkHex`) |
| `defaultTextSpeed` | Milliseconds per typed character for the whole module |
| `defaultFontSize` | Text size in pt (normal text is 27pt) for the whole module |
| `customColors` | Your own color classes, e.g. `{ "toxic": "#88ff00" }` (names: a–z, 0–9, `-`) |
| `terminalType` | `"alien"` wraps every screen in the file-system frame |
| `alien.title` | Default title-bar text for that frame |
| `script` | ID of optional module code in `src/scripts/terminal/` (built-in modules only) |

### Screens

Each screen has an `id`, a `type` and a `content` array. Optional keys:
- `onDone: { "target", "delayMs" }` auto-advances when the screen finishes.
- `defaultTextSpeed` and `defaultFontSize` set the typing speed and text size for this screen only.
- `title` and `headerTitle` are used by file-system screens.

| `type` | Behavior |
|---|---|
| `screen` | Elements type out one after another |
| `static` | Everything appears at once |
| `filesystem` | A three-region file browser: folders, then files, then the file's contents (see below) |

### Elements

A plain string is a line of text. Objects use `type`:

| Type | Description |
|---|---|
| `text` | Text with optional `className`. Supports markdown: `#` headings, `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `[links](https://…)`, `-` bullets, `>` quotes, `---` rules; `\` escapes. |
| `link` / `href` | Navigates to a screen, opens a dialog, runs an action, or opens an external URL |
| `bitmap` | An image that resolves pixel by pixel. Options: `scale`, `fillWidth`, `animated`, `background`, `className` |
| `prompt` | A command line with `commands`, or `allowFreeInput` + `inputAction` to accept any text |
| `login` | Username/password with `credentials` (each with a `target` or an `action`) and `noMatchTarget` / `noMatchAction` |
| `toggle` | Click to cycle between states |
| `list` | Like `toggle`, for ordered choices |
| `dropdown` | Expands to show every state so one can be picked directly |
| `table` | Box-drawn data grid (see below) |
| `reportcomposer` / `reportlist` | Players write entries that are saved locally and listed elsewhere |
| `mainframegame` | The APHELION arena mini-game; finishing it plays a terminal-shutdown ending |

Any element also accepts:
- `className`
- `align` (`left` / `center` / `right` / `justify`)
- `speed`, a per-element typing speed
- `fontSize`, a per-element text size in pt
- `loop`, to repeat the element N times
- `scriptId`, a handle for module code

**States.** Each state of a `toggle`, `list` or `dropdown` takes `text` and `active`, plus any of these optional keys:
- `className`
- `dialog`: show a dialog when switching to this state
- `requireShift`: a plain click shows the dialog and only Shift+click switches
- `target`: open a screen
- `action`: `back`, `dialog` or `resetState`

**Link targets.** A target is a screen id, or an array of entries:
- `{ "type": "link", "target": "screen-id" }`
- `{ "type": "dialog", "target": "dialog-id" }`
- `{ "type": "href", "target": "https://…" }`
- `{ "type": "action", "action": "back" | "dialog" | "resetState" }`

Add `"shiftKey": true` to an entry to run it only on Shift+click.

**Prompt commands.** Each command's `action` is `link`, `dialog`, `action`, `console` or `logEntry`.

**Dialogs.** Entries in `dialogs[]` with `"type": "alert"` can contain text, images and prompts. `"showActions": true` with `"actions": [{ "label", "target"? }]` adds buttons, and `defaultFontSize` sizes the dialog's text.

### File-system screens

A `filesystem` screen is a self-contained file browser, inspired by the corporate data terminals in *Alien: Isolation*. It has a title bar (`headerTitle`, falling back to `config.name`) over a framed CRT viewport.

- Its `link` elements become the **folders** down the left.
- Each folder's target screen supplies the **files**: that screen's links, or the screen itself, labeled by its `title`.
- The selected file's target supplies the **body**. The body renders like a normal screen, so text, markdown, images, tables and interactive elements all work.
- Navigate with the arrow keys, `Enter`, `Home` / `End` and `Backspace`, or click.

A link with a plain string target opens content. A link with an **array** target is a button that navigates away or runs an action:

```json
{ "type": "link", "text": "‹ LOG OUT", "target": [{ "type": "action", "action": "back" }] }
```

Inside a file, a link or table row with a plain string target opens that screen in place. See `src/data/ypsilon14-filesystem.json` (YPSILON-14 FILE SYSTEM) for a complete example.

### Data tables

```json
{
  "type": "table",
  "title": "CREW MANIFEST",
  "columns": [{ "key": "id", "label": "ID", "align": "right" }, "NAME", "STATUS"],
  "rows": [
    ["001", "MORLEY, D.", "ACTIVE"],
    { "cells": ["003", "VOSS, K.", { "text": "MISSING", "className": "alert" }], "target": "crew-voss" }
  ],
  "sortable": true,
  "filter": true,
  "pageSize": 8,
  "border": "single"
}
```

**Columns** are strings or `{ "key", "label", "align", "width" }`. **Rows** can be arrays, `{ "cells", "target", "className" }` objects, or objects keyed by column key. A row's `target` is any link target. A **cell** can be a value or `{ "text", "className" }`.

**Options:**
- `border`: `single`, `double`, `ascii` or `none`
- `sortable`
- `filter`: adds a `QUERY>` search line
- `pageSize`
- `sort`: `{ "column", "direction" }`
- `footer`
- `emptyText`
- `speed`: ms per printed line

**Controls:** `↑` / `↓` select a row, `Enter` opens it, `1`–`9` or a header click sorts, `/` searches, `←` / `→` page.

**In the Module Creator,** **[GRID]** edits a table like a spreadsheet and **[TEXT]** accepts pipe-separated rows (`a | b | c >> screen-id`) for pasting in bulk.

### Class names and images

`className` holds space-separated classes:
- **Colors** (`alert`, `notice`, `emphasis`, `system`, plus your `customColors`): one per element.
- **Layout** (`center`, `title`, `small`, `inline`): combine freely.
- **Images** take one blend mode (`monochrome`, `screen`, `lighten`, `multiply`, `difference`, …) plus `footer`.

The darkening blend modes turn images almost black on dark themes. Give the image a `background`, either a theme color (`fg`, `bg`, `alert`, …) or any CSS color, so the blend has something to mix with. The sample module's **IMAGES + CLASS NAMES** section shows every combination, and **FONT SIZES + CUSTOM COLORS** shows sizes and custom colors.

### Loading your module

- **Without building:** use **MODULE > UPLOAD JSON**, or publish it from **MY MODULES**. Host images somewhere public (a CDN, Imgur or your own server).
- **Built in:** add the JSON to `src/data/`, import it in `src/data/index.ts`, and add it to `BUNDLED_SCRIPTS`.
- **Module code:** optional TypeScript files in `src/scripts/terminal/`, attached through `config.script`. They can react to screens, prompts and toggles, and change any element that has a `scriptId`.

---

## Running it yourself

Requires Node 20.19+ (or 22.12+).

```
npm install
npm start          # dev server at http://localhost:3000
npm run build      # production build in build/ (served from /phosphor/)
npm run preview    # serve the production build locally
```

The terminal, Module Creator and JSON upload work with no backend. Accounts, modules, the Library and feedback need **Supabase**:

1. Create a Supabase project and enable the **Google** auth provider.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. It's idempotent, so re-run it after pulling updates.
3. Create a `.env` file:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```
4. To make yourself an admin (feedback inbox), sign in once, then run:
   ```sql
   update public.profiles set role = 'admin' where id = '<your-user-id>';
   ```

**Deploying:** `npm run deploy:worker` builds the app and deploys it as a Cloudflare Worker (`wrangler.toml`, `worker.js`), with security headers included.

---

## License

MIT. See [LICENSE](LICENSE). Original project © Breon Halling.
