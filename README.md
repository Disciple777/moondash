# Moondash 🌙

A Notion-style markdown editor that lives everywhere at once:

- **Web + mobile** — a PWA with a rich block editor (TipTap) that stores docs in the cloud
- **Windows desktop** — an Electron app that binds to a local folder and keeps it in sync with the cloud
- **Cloud** — every doc is stored using the same **bits** structure as the Board & Stickly apps
  (a `bits` row + `bit_notes.body` for the markdown), so it plays nicely with your existing
  database and future apps

```
┌──────────────┐   ┌──────────────────┐   ┌───────────────────┐
│  Web / PWA   │   │  Windows desktop │   │  Phone (PWA)      │
│  React+Vite  │   │  Electron + sync │   │  installable      │
└──────┬───────┘   └────────┬─────────┘   └─────────┬─────────┘
       │        HTTP / JSON │                       │
       └────────────────────┼───────────────────────┘
                            ▼
                 ┌────────────────────┐
                 │  PHP API (backend) │   Hostinger
                 │  bits + doc_files  │
                 └─────────┬──────────┘
                           ▼
                ┌─────────────────────┐
                │ MariaDB u480328775_ │
                │ bits (shared DB)    │
                └─────────────────────┘
```

## Repository layout

| Folder     | What it is                                                              |
| ---------- | ----------------------------------------------------------------------- |
| `backend/` | PHP 8 API — same architecture as your Board app (App container, Request/Response, bearer-token auth) |
| `web/`     | React + Vite + TipTap editor, PWA for mobile                            |
| `desktop/` | Electron shell + folder-sync engine (manifest + revisions)              |
| `board-app/` | **Reference only** — not used by Moondash                              |

## How docs map to your bits database

Every markdown file becomes a **bit**:

- `bits` row: `bit_type = 'doc'`, `title` = filename, `content_preview` = first 180 chars
- `bit_notes.body` = the full markdown content
- `doc_files` (new table) maps the doc to a **workspace-relative path** and tracks the
  `content_hash` + `revision` used by the sync engine

This means all your existing bit tooling (relations, comments, attachments, checklists…) can
hang off Moondash docs too.

## Setup

### 1. Database (once)

Run `backend/schema.sql` in phpMyAdmin on `u480328775_bits`. It only **adds** tables
(`workspaces`, `doc_files`, `bit_folders`, `workspace_doc_links`) and columns (a guarded
procedure adds `type` / `color_hex` / `icon_key` to existing `workspaces` rows) and indexes
`bit_relations` for the folder tree. It never touches existing data and is safe to re-run
(idempotent).

### 2. Backend API

Deploy the `backend/` folder to Hostinger (e.g. `public_html/moondash-api/`), then create
`backend/.env` (copy from `.env.example`):

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=u480328775_bits
DB_USER=u480328775_youruser
DB_PASS=yourpassword
AUTH_TOKEN_TTL_DAYS=30
```

Verify it's alive: `GET https://your-host.com/moondash-api/api/workspaces` should return
`{"message":"Authentication required"}` (that means routing works).

### 3. Web app

```bash
cd web
npm install
cp .env.example .env   # optional — set VITE_API_URL to your deployed API
npm run dev            # local dev on :5173 (proxies /api to a local PHP server on :8000)
npm run build          # production build → web/dist (deployable anywhere, uses relative paths)
```

The build uses **relative paths** (`base: './'`), so `web/dist` works from any subfolder — and
from the Electron `file://` window. Production builds bake in the API base from
`web/.env.production` (`VITE_API_URL=https://guatermelon.com/moondash/backend/public`), so a
fresh desktop install on a new PC can log in straight away. The **login screen** shows which
server the app talks to and has a *Change* link to point it elsewhere (this also updates the
desktop sync engine). You can also change the server from the browser console:

```js
localStorage.setItem('moondash.apiBase', 'https://your-host.com/moondash/backend/public')
location.reload()
```

### Deploying to Hostinger (worked example)

- Upload `backend/` so `index.php` + `.htaccess` land at `public_html/moondash/backend/public/`,
  with `src/` next to `public/`. Create `backend/.env` from `.env.example`.
- Upload the **contents** of `web/dist` (or the `moondash-web-dist.zip` from the repo root) into
  `public_html/moondash/` — next to (not inside) the `backend/` folder.
- The app is now at `https://your-host.com/moondash/` and the API at
  `https://your-host.com/moondash/backend/public/api/...` (routing via `.htaccess`).
- Set the API base in the app: either build with `VITE_API_URL=https://your-host.com/moondash/backend/public`,
  or use the localStorage override above (recommended — no rebuild needed).

### 4. Desktop app (Windows)

```bash
cd desktop
npm install            # downloads Electron (~100 MB)
npm start              # builds the web app if needed, then launches Electron
```

#### Building a Windows .exe

To package the desktop app into a standalone `.exe` for distribution:

```bash
# 1. Build the web app first (if you haven't already)
cd web && npm run build

# 2. Package the Electron app
cd ../desktop && npm run package
```

This produces:
- `desktop/dist-release/Moondash-win32-x64/Moondash.exe` — the standalone app
- `desktop/dist-release/Moondash-1.0.1-win32-x64.zip` — zip ready to share

To install: run `Moondash.exe` directly, or extract the zip and run it from there.

In the app: create/log into your account → pick a workspace → **Local sync → Connect a folder**.
If your API is hosted remotely (not `localhost:8000`), set it first: **Local sync → ⚙️ Server
URL** → paste e.g. `https://your-host.com/moondash/backend/public` → Save.
The engine:

1. **Pull** — downloads the cloud manifest, writes new/changed docs into the folder, trashes
   deleted ones
2. **Push** — scans the folder (`.md`, `.markdown`, `.txt`), uploads new/changed files, reports
   deletions
3. **Watch** — `fs.watch` + a 20s poll keep both sides in sync while the app runs
4. **Divergences** — if a file changed on both sides since the last sync, the engine compares
   modification times (local `mtime` vs cloud `updated_at`) and the **newer side wins**: the
   local folder and the cloud are reconciled automatically, with no `.conflicted-*` copies.
   Any `*.conflicted-<timestamp>.*` files left over from older versions are resolved on the
   first sync (newest copy is kept, the stale one is deleted, and its cloud duplicate is
   removed via the normal deletion flow).
5. **Dates** — dates are inherited from the filesystem, both ways. Every push sends the local
   file's `mtime`, which the cloud stores as the doc's `updated_at` — so files that were never
   modified in the app keep their **real disk date** (this is what "Last modified" sorting uses
   on web, mobile and desktop). Pulls stamp the cloud's `updated_at` onto the local file's
   mtime, so a doc edited in the app shows that edit time on disk too. On the first sync after
   this update, already-synced files whose cloud date is a stale sync stamp (newer than the
   real file date) are re-pushed once to repair the date; it's self-limiting, so it never
   repeats.

While on desktop, the editor writes straight to the local file (offline-first); the watcher
pushes to the cloud automatically. On web/mobile, the editor saves directly to the API.

**Multiple folders** — the desktop app can sync several folders at once, one per workspace
(**Local sync → Connect a folder** for each workspace). Each row shows its own status and
has per-folder *Sync now* / *Unlink* actions. Manifest state is keyed per folder, so re-binding
or switching folders never wipes cloud docs.

**Open .md files with Moondash** — on Windows the app registers itself as the handler for
`.md` / `.markdown` files (HKCU, no admin needed). Double-clicking a file opens Moondash:

- If the file is inside a synced folder, its workspace opens with that page (edits sync normally)
- Otherwise it opens **in place** — the content becomes a page in the current workspace and
  saves go to the cloud only (nothing is copied into a synced folder)

The association is a toggle in **Local sync → ⚙️ Settings**, and stays on across restarts
unless you turn it off.

The sync card is intentionally minimal: it shows only the **current workspace's** status
(Synced / Syncing / error / Not connected). Click it to expand and manage every synced folder
(status, per-folder *Sync now*, *Unlink*), the server URL, and the file-association toggle.

**Editing workspaces** — the workspace picker (top of the sidebar) is a themed dropdown showing
each workspace's **icon + color** (same lucide icon set and swatches as folders). Every row has
✎ edit / 🗑 delete actions, and **New workspace** opens a dialog with name, description, **type**
(Folder workspace or Multi-space), **color** and **icon** — matching your current theme. The
  dialog is scrollable when it doesn't fit the screen (the actions stay reachable), and its
  icon grid is explicitly themed so lucide icons never render black on dark palettes.

**Sidebar search & sort** — the page search box now actually filters: it matches page titles and
folder names (case-insensitive) and shows matching docs inside folders (a folder whose own name
matches shows all its pages). Next to *New folder* there's a sort toggle to order pages by
**Name** (current default) or by **Last modified** (`updated_at`), applied in both folders and
Unfiled. Your choice persists across sessions.

**Settings → Themes** — the ⚙️ button in the sidebar opens Settings. Pick an appearance mode
(**System** / **Light** / **Dark**) and one of nine palettes: **Default** (the original look),
**Ocean**, **Forest**, **Ember**, **Grape**, **Mono**, **Cyber** (hacker green #00ff77 on pure
neutral dark gray), **Cherry** (hot pink #ff0059 on pure neutral dark gray), and **Ultraviolet**
(electric blue #1500ff on dark gray). Each palette ships a light and a dark variant, the choice applies instantly (with a
soft cross-fade), and it persists in `localStorage` — the login screen and the desktop app
follow it too. New palettes are added by extending `web/src/theme.ts` plus a
`html[data-theme='...']` variable block in `styles.css`.

## API overview

| Method | Path                       | Purpose                                  |
| ------ | -------------------------- | ---------------------------------------- |
| POST   | `/api/auth/register`       | Create account, returns bearer token     |
| POST   | `/api/auth/login`          | Log in                                   |
| POST   | `/api/auth/logout`         | Revoke token                             |
| GET    | `/api/workspaces`          | List workspaces                          |
| POST   | `/api/workspaces`          | Create workspace                         |
| PATCH  | `/api/workspaces`          | Rename workspace / edit description      |
| DELETE | `/api/workspaces`          | Delete workspace (+ its docs)            |
| GET    | `/api/workspaces/tree`     | List docs **+ folders + memberships**    |
| POST   | `/api/workspaces/links`    | Link a doc into a multi-space            |
| DELETE | `/api/workspaces/links`    | Unlink a doc from a multi-space          |
| POST   | `/api/docs`                | Create doc (path + markdown)             |
| GET    | `/api/docs/detail`         | Fetch one doc's markdown                 |
| PATCH  | `/api/docs`                | Update title / content / path            |
| DELETE | `/api/docs`                | Soft-delete a doc                        |
| GET    | `/api/sync/manifest`       | Full path → hash/revision/deleted map    |
| POST   | `/api/sync/push`           | Batch upsert files (bumps revisions)     |
| POST   | `/api/sync/remove`         | Soft-delete a path (bumps revision)      |
| GET    | `/api/sync/file`           | Download one doc's markdown              |
| GET    | `/api/sync/external`       | Linked-in-place docs (local_path) list   |
| POST   | `/api/folders`             | Create folder (name, color, icon, parent)| 
| PATCH  | `/api/folders`             | Rename / recolor / change icon           |
| DELETE | `/api/folders`             | Delete folder (+ subfolders; docs kept)  |
| POST   | `/api/folders/members`     | Add doc to a folder                      |
| DELETE | `/api/folders/members`     | Remove doc from a folder                 |
| POST   | `/api/folders/move`        | Move a folder (cycle-guarded)            |
| PATCH  | `/api/folders/members/order` | Reorder docs inside a folder           |

All routes (except register/login) require `Authorization: Bearer <token>`.

## Folders (organizational, database-only)

Folders are **not** filesystem directories — they live purely in the database:

- A folder is a bit (`bit_type = 'folder'`) with metadata in `bit_folders` (workspace, color, icon)
- Membership reuses your existing `bit_relations` table with `relation_type = 'member'`
- **One note can live in many folders at once** — it's the same bit, so edits reflect everywhere
- Folders nest inside folders (drop a folder onto another)
- Deleting a folder deletes its subfolders but **keeps the docs**
- Dragging a page onto **Unfiled** removes it from all folders
- The sync engine is unaffected: folders don't touch `doc_files` or file paths

## Multi-spaces (gather docs from different folders)

A **multi-space** is a second kind of workspace (chosen when creating a workspace): instead of
mapping 1:1 to a local folder, it's a cloud-only space that gathers individual documents that
live in your other (folder) workspaces — e.g. the `README.md` of every project folder you sync.

- **Link docs in** — *Add a document* in the sidebar (or the home screen) opens a searchable
  picker of every page across your folder workspaces. Docs already in the space are excluded.
  Each linked doc is the **same bit** as the original: editing it in the multi-space edits the
  real file (and the desktop app syncs it back to its original folder automatically).
- **Import a file from your computer** — the same *Add a document* modal has a drop zone:
  pick or drag any `.md` / `.markdown` / `.txt` file from your machine (or drop it anywhere on
  the multi-space home / sidebar). Name collisions get a `-1`, `-2`… suffix automatically.
  Two modes:
  - **Desktop (link in place)** — the file stays EXACTLY where it lives on disk (e.g.
    `C:\Users\…\project\README.md`). Moondash records its absolute path and links it into the
    multi-space: no copy, no new folder, no "which workspace" prompt. Edits in the app are
    written straight back to that file, and the desktop **linked-file engine** mirrors disk
    changes to the cloud every ~20s (same last-write-wins-by-date policy as folder sync —
    whichever side was modified last wins, no conflicted copies). Docs linked this way appear
    under a "Linked files" group in the sidebar, and removing them from the space only unlinks
    (the file on disk is never touched).
  - **Web (no disk access)** — the file's content is read and given a home in one of your
    folder workspaces (you pick which if you have more than one).
- **Grouped by source** — linked docs are shown grouped under the workspace they actually live
  in (with that workspace's icon + color), so provenance stays obvious.
- **Folders work too** — you can create organizational folders inside a multi-space and file
  linked docs into them, exactly like in a folder workspace. Removing a doc from a folder just
  moves it back to the top-level list.
- **New page in a multi-space** — *New page* (or the folder's **+**) asks which folder
  workspace to create the file in, creates it there (so it syncs to disk), then links it in.
- **Remove = unlink** — deleting a doc from a multi-space only removes the link; the original
  file stays in its workspace untouched. Deleting the whole multi-space keeps every doc too.
- **No folder binding** — multi-spaces never bind to a local folder; the *Local sync* card
  shows *Multi-space (no folder)* instead.

Storage: `workspace_doc_links(workspace_id, bit_id)` — a tiny join table, nothing else. The
multi-space's folders reuse `bit_folders` + `bit_relations` scoped to the multi workspace, and
`FolderService::addDoc` is relaxed so a multi-space folder may hold docs from any of the user's
workspaces.

Linked-in-place docs store their absolute path in `doc_files.local_path` and live in a hidden
per-user `workspaces` row of `type='external'` (auto-created, never listed). The desktop
linked-file engine (`desktop/src/linked-sync.js`) polls `GET /api/sync/external`, pushes disk
changes, and pulls cloud changes — same LWW-by-date policy as folder sync.

## Password-protected notes

Any page can be sealed with a password: the lock button in the note toolbar asks for one
(twice), and from then on the note is **encrypted before it is written anywhere**. The `.md`
file on disk, the `bits` row, `bit_notes.body` and `content_preview` in the cloud, and
everything the sync engine pushes all hold only an opaque envelope:

```
-----BEGIN MOONDASH ENCRYPTED NOTE-----
v1.310000.<salt>.<iv>.<ciphertext>
-----END MOONDASH ENCRYPTED NOTE-----
```

- **Crypto** — PBKDF2-HMAC-SHA256 (310,000 iterations, the OWASP floor, with a fresh 16-byte
  salt per note) derives a 256-bit key; the body is sealed with AES-256-GCM under a fresh
  12-byte IV on every save. Keys are derived non-extractable via Web Crypto and held in memory
  for the session only — never written to disk, never sent to the server. Closing the app or
  signing out re-locks everything.
- **Opening one** — the lock screen replaces the editor until the right password arrives, and it
  asks **every time the note is opened**, even if it was unlocked earlier in the same session.
  This works for workspace pages and for `.md`/`.txt` files double-clicked from disk.
- **A wrong password is reported as wrong**, not silently decoded into garbage. That is
  deliberate: GCM authenticates the ciphertext, so a bad password (or a file edited behind the
  app's back) fails cleanly and the note is left untouched. Showing plausible garbage instead
  would let the autosave write it back over the real note.
- **Not protected** — the note's title/filename, its timestamps and its size stay in the clear.
  Only the body is encrypted.
- **There is no recovery.** Forget the password and the note is gone; there is no reset and no
  backdoor. Removing protection (same button) writes the note back as ordinary text.

## File fidelity (what you write is what's on disk)

Notes are real `.md` / `.txt` files, and the editor autosaves, so the editor must never
rewrite what it can't show. A note read from disk is written back byte-for-byte unless you
actually change it (`web/src/extensions/MarkdownFidelity.ts`, covered by
`npm run test:fidelity`):

- **Line breaks** — a newline inside a paragraph is a real line break (not joined into one line).
- **Blank lines** — extra blank lines between blocks are kept as empty lines, and pressing Enter
  several times is saved as blank lines.
- **Angle brackets** — text like `<something here>`, `List<T>` or `<!-- note -->` is kept as text
  (pasting it, typing it, or in the raw view). Only the few HTML tags the editor itself uses —
  text-colour spans, toggles, tables — are treated as HTML.
- **Backslashes** — Windows paths keep single backslashes.
- **Line endings** — a Windows (CRLF) file stays CRLF.
- **`.txt` files** are edited as **plain text** (monospace, no formatting toolbar) and saved exactly
  as typed — no markdown escaping (`array[0]`, `a_b * 2`, `# not a heading` stay literal).
  Name a new page `something.txt` to create one.
- Formatting that markdown itself normalises is written in its canonical form once: `* item`
  becomes `- item`, `__bold__` becomes `**bold**`, entities like `&copy;` become `©`.

## Editor extras

- **New page** asks for a name first (no more "Untitled" files) and the page starts empty —
  the title shown above the note *is* the file name. In a multi-space you pick the workspace
  that will own the file, then name it.
- **Block handle** — hover a block to reveal its grip. **Click** it to select the whole block
  (Shift-click extends the selection), **drag** it to move, **right-click** it to *Turn into*
  another type: text, heading 1–3, bullet / numbered / to-do list, toggle, quote or code
  block. Right-clicking a block inside a multi-block selection converts the whole selection.

- **Date shortcut** — type your configured shortcut (default `@date`, set in ⚙️ Settings) and
  today's date is inserted in the format you pick (month-first, day-first, ISO, long/short,
  with/without weekday). Disable it anytime in Settings.
- **Text color** — the toolbar palette button colors selected text (or upcoming typing).
  Colors persist in the markdown as `<span style="color:…">` (requires the editor's
  `html: true` markdown mode), so they round-trip through sync and the `.md` files on disk.
- **Block dragging (Notion-style)** — hover a block to reveal a grip handle, then drag it:
  reorder paragraphs/headings/blockquotes/code blocks, reorder list items inside a list,
  move items between lists, or drag an item out of a list entirely. A colored drop line
  with a marker dot shows exactly where the block will land. **Multi-select drag** — select
  several lines and drag any of their grips to move the whole selection at once (list items
  move as a fresh list, keeping unselected items in place). **Toggle-aware** — a toggle's
  title drags the whole toggle (the drop line flips at the title/content boundary so it
  never jumps around), while content blocks inside a toggle are individually draggable and
  other blocks can be dropped between them to nest content inside the toggle. **Precise
  drops into lists** — the drop line tracks individual list items (never snapping to the
  whole list's top/bottom), and the drop lands exactly there: dragging same-type items into
  a list **merges** them into it (like copy-paste), while a toggle or a different list type
  **splits** the target list around the insertion point so the content sits right between
  the hovered lines. **Edge auto-scroll** — while dragging, holding the pointer near the
  top or bottom edge of the window scrolls the editor up or down (speed ramps with how
  close the pointer is to the edge), so long documents scroll as you drag toward the ends.
- **Toggle lists (Notion-style)** — insert a toggle from the toolbar or the `/` menu
  (`/toggle`). The first line is the bold title; click the arrow to collapse or expand
  everything below it. Toggles nest, hold any block type (lists, quotes, other toggles,
  even code blocks), and round-trip through the `.md` files as `<details class="toggle">`.
  Nesting is keyboard-driven, exactly like Notion: a fresh toggle starts with an empty title
  and a faint "Toggle heading" prompt — **Enter** on the empty title hops straight into the
  content (inside), and **Enter** at the end of a typed title opens a new content line inside;
  **Tab** at the start of a block right after a toggle moves it inside that toggle (and inside
  a toggle, nests into a preceding sub-toggle); **Shift-Tab** on the title converts the toggle
  back to plain blocks, or on a content block pulls it back out. Content blocks are indented
  with a subtle guide line so nesting reads clearly.
- **List markers** — bullet and ordered lists (including **nested/indented** items at any
  depth, mixed list types, and lists inside toggles) render explicit markers: bullets use
  `disc`, ordered lists `decimal`, to-do lists correctly show checkboxes instead. Verified
  end-to-end in a real browser (all item types, keyboard-created nesting via Tab, and the
  markdown save/reload round-trip).
- **Task lists & backspace** — pressing Backspace at the start of an empty checkbox line
  removes the whole item in one press (first, middle, or last — no ghost indented space is
  left behind). Bare `- [ ]` lines (empty items) also survive save/reload as real checkboxes
  instead of turning into literal "[ ]" bullets.
- **Back to workspace** — the Home button at the left of the note toolbar returns you to the
  workspace home view (recent pages + New page) without leaving the workspace.
- **Mobile layout** — on small screens the sidebar becomes a slide-in drawer opened by the
  menu button, so the note takes the full width. Choosing a page or folder closes it
  automatically.

## Tests

`cd web && npm test` runs every suite: markdown fidelity, encryption, tables, toggles
(round-trip + keyboard), task-list backspace and block dragging. They use the real
tiptap-markdown pipeline in jsdom (a dev dependency, pinned to v24 — newer jsdom needs a
newer Node than 20.15).

## Roadmap ideas

- Attachments & images inside docs (your `bit_attachments` / `bit_linked_file_bits` structure)
- Sharing workspaces between users (`bit_relations`-based sharing model)
- Native mobile apps (Tauri 2 / Capacitor wrapping the same web app)
- Local web mode using the File System Access API
- Tauri shell to replace Electron (same renderer code)

---

> `board-app/` is kept in this repo purely as architecture reference. Moondash shares its
> database and patterns, but is a separate codebase.
