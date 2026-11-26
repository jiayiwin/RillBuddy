# RillBuddy

[中文](README.zh-CN.md)

RillBuddy (睿洱) is a Windows desktop companion for coding agents and tasks you jot down. It shows when work is running, needs your attention, finishes or fails. The workbench lets you see which source and project each update belongs to. You can also ask the companion to play music, start the radio or put on a soundscape.

It runs entirely on your machine. Windows 10/11 only. Built with Rust, Tauri 2 and TypeScript/Canvas.

**Supported agents** include Claude Code, Codex, WorkBuddy / CodeBuddy, DeepSeek Harness, Gemini CLI, Cursor and OpenCode. See [setup instructions](#4-hook-up-other-agents).

![Workbench with animated computer screens, pet workers and a selected WorkBuddy task](docs/images/workbench-demo.zh.png)

Screenshots show the Chinese interface with fictional sessions and projects.

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Using it](#using-it)
- [Configuration](#configuration)
- [Building from source](#building-from-source)
- [Layout](#layout)
- [Privacy and security](#privacy-and-security)
- [FAQ](#faq)
- [License and assets](#license-and-assets)

## What it does

### It watches your work world

- **One stable desktop companion**: Zimeng, Mashu, Paopao, Gugu and Rongrong are wardrobe looks for the same companion. The workbench and hover card show each source, project and session; the desktop pet only expresses the most pressing global state.
- **Read the face.** It watches while the agent works, hops when a turn ends well, frowns at a failure, gets drowsy with nothing to do, and sleeps when it sleeps.
- **Waiting for you is the loud one.** When the agent stops for your answer or approval, it looks up at once, a coral "Waiting on you." appears over its head, and two piano notes sound. Nothing else in the app uses that colour.
- **Hover for a second** for the session card: project, state, how long it has run, the last tool. **Double-click** to bring that session's terminal or IDE to the front. The card sits above the pet, or beside it when there is no room above, never over it.
- **In hand.** Right-click, Keep me company → Write something down: type one line in the bubble over its head and press Enter; with text selected, `Ctrl+Alt+N` starts from that text. While it holds something for you, a slip of paper is pinned at its side (no number). The workbench lists these beside sessions: tick one and it balls up the slip and eats it; tick again to put it back. A line like "when Claude is done…" waits: once that session stops and you are at the desk, the companion brings it up, and Yes takes you to that window. The "Next step: …" line a source ends its session with becomes a slip by itself (at most 4 open per source); nothing else of its reply is read. What is left from yesterday comes up the next morning, in the same line as the night's tidy.
- **Approve permissions on the pet** (optional, off by default): when Claude Code asks for permission, a card opens above the pet; click Allow or Deny without going back to the terminal. See [Approving permissions on the pet](#approving-permissions-on-the-pet).

### It watches you, too

It reads one thing about you: how long since the keyboard or mouse was last touched (not what you typed, not what is on the screen). From that it recognises a few situations, answers each with one act, and says what it noticed first:

| It notices | It does |
|---|---|
| You have sat for 90 minutes straight (60 between 1 and 4 pm) | Dances, or turns its back and leads a kegel set; the two take turns |
| It is past 11 pm and you are still here | Plays a piece on its own instrument |
| A work source got stuck 3 times in half an hour | The companion plays a piece |
| A source has waited 3 minutes for you while you sit right there | The companion reminds you |
| A job that ran 15 minutes or more just finished | Dances |
| You come back after a while away | Says nothing; how they are tells you: asleep by a stack of pages, it finished while you were out; holding a slip up at you, it is waiting for you; back still turned, it is still at work. After a minute and a half (or once you look at it) they are as before, and only then does the one waiting on you ask whether to take you there |
| An agent has been on one job 8 minutes or more and you have stopped to wait on it | Asks whether to play the radio; "Yes" plays one of your regular stations |
| After 10 pm you have sat for half an hour | Asks if you'd like something quiet; "Yes" plays from the Quiet shelf |
| The agents' sessions older than a month pass 1 GB (once a week at most) | Asks whether to tidy the storeroom; "Yes" opens it |
| You switch to the desktop and several icons are out of their columns (once a day at most) | Asks whether to sweep the desktop; on "Yes" it rides its broom over, sweeps the icons back into the columns and returns. The bubble afterwards offers "Put them back", which undoes it |

A sweep changes only where icons sit; files are never moved or changed. Icons already in a column stay put, and the others go into the next free cells; when most icons are out of place, the whole desktop is sorted by type (system icons and shortcuts keep their order, files go by name). It does not sweep when desktop icons are hidden or Auto arrange is on.

The ones with "Yes" and "Not now" on the bubble are questions: nothing plays unless you say yes. It doesn't ask while the radio is on or in quiet mode, and once asked it lets it be for hours.

Two acts are at least 10 minutes apart. In focus mode, or with chattiness set to quiet, it does nothing on its own. Click it and it stops.

The sound is sampled from real instruments, and each pet has its own instrument and its own way with it: Zimeng plays a row of floating keys with both ears; Mashu bows a cello with its tail; Paopao blows a flute held sideways, and every note leaves the end of it as a bubble; Gugu strikes a small xylophone with two mallets, each bar lighting as it is struck, and the spots on its cap with it; Rongrong plucks a small harp standing beside it with the ear on that side: the plucked string shivers, and notes drift up from it. Each has nine dance moves, one of them a tail wag with its back turned.

### Several sources together

The workbench sorts agent sessions and tasks by urgency. The companion shows the most pressing state. When a session has a window to return to, open it from the hover card or the workbench.

The companion can dance, play its instrument or play a soundscape. Choose automatic ambience, silence, rain to settle in, wind for work, light rain while waiting or night ambience to wind down.

### The companion is a whole skin

The companion is more than a figure. Its wardrobe look supplies the colours of the room, the right-click menu, the letter paper, the radio and approval card, the mark on the envelope, the waiting notes and the way it talks. The gallery is where you change that one global look. Work sources keep their identity in the workbench and never create extra desktop windows.

### The room, letters and the rest

All of these open in **one window**, each as a tab: pick a feature and a tab is added, and a tab can be closed. The window draws its own frame, in the colours of the pet whose page is in front. Closing the window only puts it away: the tabs are still there and the radio keeps playing; closing the radio's tab is what stops it. Pull the bottom-right corner to make it bigger; double-click the empty part of the tab bar to fill the screen.

- **The room**: where it sits. On the left, the pet and what it is saying; on the right, today: your time at the desk and the breaks you took, the agents' time, turns and failures, and "what it noticed today", one line for each thing it did on its own. You can play with it here: its eyes and head follow your pointer; a click is a poke, and a few quick ones make it spin itself dizzy; press and drag across it to turn it round and see its back; stroke its head and it shuts its eyes; "Tease it" hangs its own charm from your pointer, and the whole room is its to move in: it runs after the charm along the floor, crouches and jumps for it when it is overhead, and if it gets its mouth on it in the air it holds on, so you can swing it about until it lets go and drops; held too high for its legs, it jumps, misses and says so (each jumps a different height: Mashu highest, Paopao least); "Spin" has it turn once on the spot; "Catch sweets" is the one small game: for thirty seconds sweets of every kind in the catalogue drift down from the top of the room, the pet runs to stand under your pointer and a click makes it jump, and what reaches its mouth it eats. Catch 20 in a round and one goes into the jar (two a day at most).
- **The workbench** lets you switch between a list and an isometric office. A computer and pet worker show each work item's state. Select a desk for the source, project and latest tool when available. The last-seven-days view shows completed turns, and Recent activity highlights updates such as waiting for you, completion and errors.
- **Sweets** are what they eat (sweets and fruit), and they are earned and kept in a jar. Which kind comes depends on the moment: each turn an agent finishes brings one (a failed turn, only an empty wrapper); some turn up only in the morning, the afternoon or at night, and each season has its own; with no agent it is up to you: a kegel set done with the pet earns a salted plum, and getting up for a while after sitting half an hour or more earns a mint leaf, up to 6 a day this way. When the jar is empty the feed button tells you how to earn. Feed the pet and it answers with a line, and now and then says something it has kept to itself.
- **Day's end** is learned from when your last turn of the evening really ends, not from the off time in the settings (until it has learned, the day's tune is still offered in the half hour before off time). In that window, while work is still running and you are here, the companion leaves a lamp on and stops bringing things up. Once every source has stopped and you are still sitting there, it asks to play the day's tune. When you get up for the night, it writes down where each source stopped and leaves the slip by its feet: waiting for your answer, stopped on an error, or the "Next step:" line from the source's last reply (that line only; nothing you wrote to the agent). A clean finish gets no slip. When you sit down the next morning, it says "Stopped at … last night. Go over?" for the most pressing item, and "Go" brings that session's window to the front; a long next step is put in a few words by the local model when it is installed.
- **Letters** are about you, not about what you did. Over the days the pet comes to see what kind of person you are from the way your days go: you go quiet and carry it alone when stuck; you keep the quietest hours for the night; what you promise yourself always waits at the back; you never stop to look at something once it is finished. A letter says that one thing it understood, and what it feels about it. There is always a reason to write: a long stuck stretch that finally gave way, several late nights, coming back after days away, something worked on for weeks gone quiet, a note it held for days that you crossed off, a day far fuller than usual, a week, a month or a season of knowing you, and now and then nothing at all. No numbers, no clock times, no names of what you work on, no praise and no advice. At most one every four days, none while one is unopened, and never twice about the same thing.
- **The gallery**: the five pets with their instruments, and the companion wardrobe look; the sweets met so far (22 kinds; one not met yet says when it turns up), what it remembers (the diary across days), and the settings.
- **The daily report**: one card you can copy as an image. It opens by itself at off time (18:00 by default) on days the agents worked; any other time, click the "The agents' day" card in the room.
- **The radio**: stations from all over the world, shelved as regulars, upbeat, quiet, crosstalk and world. It listens along and says what it knows ("First time on this one.").
- **The storeroom** (in the settings, under Language and work sources): what your agents keep on this machine. On disk, the session records: Codex keeps every one forever (on a machine in daily use that easily reaches several GB), Claude Code clears its own after a month. Sessions older than 30 days can be packed into one box in Rill's folder (the box is checked before any original goes; the last 30 days are never touched) and put back, dates and all, with one click. And what every new session reads before you say a word: the CLAUDE.md / AGENTS.md files from your home and up the project's folders, the memory index, the text start-up hooks put in, the skills listed for it and the MCP servers it connects to, each with a rough token count, marked where the last month's sessions never used it. Unused skills can be put away in the storeroom (and brought back) from here; for the rest it says what to change and gives the command. Everything is counted locally: nothing is sent and no tokens are spent. Once a week at most, when the old sessions pass 1 GB, the pet mentions it.
- **Bugs**: when a work source's tool fails, bugs drop to the bottom of the screen. The companion runs along the bottom and pounces on them itself, and you can click one first. Three failures in a row bring a big one that pins it where it stands; your clicks count too, until it is gone and the companion can move.

![The room shows desk time and activity by agent, including WorkBuddy and DeepSeek Harness](docs/images/room-demo.zh.png)

![The gallery shows five wardrobe looks for the desktop companion](docs/images/gallery-demo.zh.png)

### Staying out of the way

- The boss key (`Ctrl+Alt+H`) hides and mutes everything at once; it also hides by itself in fullscreen and while you share your screen in a meeting.
- "Quiet for a while" (focus mode, `Ctrl+Alt+F`) keeps only the status and the "waiting for you" alert.
- It talks only to `127.0.0.1`, with a token. Three things go online, all listed under [Privacy and security](#privacy-and-security): the radio, downloading the local language model, and letter writing when `ANTHROPIC_API_KEY` is set.

## Quick start

### 1. Install

1. Download `RillBuddy_<version>_x64-setup.exe` from the Releases page, or [build it yourself](#building-from-source).
2. Run the installer. It installs for the current user and needs no administrator rights. It is not code-signed yet, so SmartScreen may stop it once; see the [FAQ](#faq).
3. Rill starts when the install finishes and, by default, with Windows (Settings → On this computer → Start with Windows turns that off).
4. On first start Zimeng acts out an agent's states for you, with the hook-up buttons on the same page. To see it again: `/pet tour`.

### 2. Hook up Claude Code

Tray → Settings… → Language and work sources → Hook up agents → **Claude Code…**

This runs `claude plugin marketplace add` and `claude plugin install rillbuddy@rillbuddy` for you (the Claude Code CLI must be installed). Restart Claude Code afterwards.

By hand, in a normal terminal:

```
claude plugin marketplace add /path/to/rillbuddy
claude plugin install rillbuddy@rillbuddy
```

With the installer, the marketplace is the `plugin` folder next to `rillbuddy.exe`. Use forward slashes on Windows too (`C:/path/to/rillbuddy`); inside Claude Code's own prompt, `/plugin marketplace add` with backslashes does nothing.

### 3. Hook up Codex

Tray → Settings… → Language and work sources → Hook up agents → **Codex…**

This appends Rill's hooks to Codex's `hooks.json`. Your own hooks stay, and the file is backed up first.

**One step you must do by hand:** run `codex` in a terminal, type `/hooks`, and mark Rill's hooks as trusted. Codex only runs trusted hooks. The ChatGPT / Codex desktop app has no `/hooks` command, but it shares the same config folder, so trusting them in the CLI is enough.

Both hook-ups show what they will change first and act only when you confirm.

By hand:

```
rillbuddy-emit --install codex
```

- Writes to `$CODEX_HOME/hooks.json`, or `~/.codex/hooks.json` when `CODEX_HOME` is not set. `--codex-home <dir>` picks another.
- Your hooks are kept as they are; Rill's go last for each event.
- The file is backed up as `hooks.json.rillbuddy-bak` first.
- The emitter is copied to `~/.rillbuddy/bin/`, so moving the repo later breaks nothing.
- Not sure which config folder Codex uses (say `CODEX_HOME` is set and `~/.codex` is in use too)? Install into both: run it again with `--codex-home %USERPROFILE%\.codex`.
- Remove: `rillbuddy-emit --uninstall codex`

### 4. Hook up other agents

Open Gallery → Settings → Language and work sources to connect these agents. You can also run these commands.

```
rillbuddy-emit --install gemini      # appends hooks in ~/.gemini/settings.json
rillbuddy-emit --install cursor      # appends hooks in ~/.cursor/hooks.json
rillbuddy-emit --install opencode    # writes a plugin to ~/.config/opencode/plugins/rillbuddy.js
rillbuddy-emit --install workbuddy   # adds compatible hooks to ~/.workbuddy/settings.json
rillbuddy-emit --install deepseek-harness # installs the native DeepSeek Harness listener
```

Swap `--install` for `--uninstall` to remove; add `--config-dir <dir>` when the config is elsewhere. Existing hooks are kept and files backed up first.

- **WorkBuddy / CodeBuddy** use Claude-compatible hooks. Open a new session after connecting.
- **DeepSeek Harness** uses a native listener for session, tool and turn events. Fully restart the desktop app or CLI after connecting and start a new session.
- **Gemini CLI, Cursor and OpenCode** adapters are experimental. Connect Cursor separately to see its sessions under its own source. You can override an adapter's event mapping under `~/.rillbuddy/adapters/`. [Adapter mappings](adapters/)

That is all. Start a session in any hooked-up source and the companion reflects the combined state.

## Using it

### Mouse

| Do | What happens |
|---|---|
| Click | A poke. While it performs, a click means "enough" |
| Stroke its head back and forth 3 times | It is pleased |
| More than 12 clicks in 5 s | It says "Enough.", hops away, and ignores you for a minute |
| Press and drag | Move it; let go with speed and it flies, bounces, and gets dizzy if it hits hard. Thrown fast enough at the left, right or top edge of the screen, it sticks there: leaning on a side and sliding slowly down it, or swinging from the top. When it tires, or you click it, or you feed it and it gets heavier, or its agent is waiting for you, it slips off, lands, and walks back to where it was picked up |
| Double-click | Brings the session's terminal or IDE to the front (the one waiting on you first) |
| Hover 1 s | The session card |
| Right-click | The menu |

Pets land on the bottom of the screen or on the title bar of a normal window, and fall when that window moves or closes. Clicks outside the pet's body pass through.

### The right-click menu

Right-click the companion to see the project it is watching and today's work time. The menu includes these options.

- **Keep me company**: dance · play the piano (the cello, for Mashu) · radio · a kegel set · write something down
- **Feed it**: with the number left in the jar
- **A letter**: only when one is waiting
- **Room** and **Workbench**
- **Quiet for a while**: the focus mode switch
- **More** lets you feed it several sweets or hide it.

### The tray panel

Click the tray icon to see the companion and the source roster. The tray opens the workbench, room and settings and controls sound, focus mode, autonomous actions, pet size and visibility.

Flipping a switch keeps the panel open; click outside it or press Esc to close.

### `/pet` commands (Claude Code)

| Command | Does |
|---|---|
| `/pet show`, `/pet hide` | Show or hide the pets |
| `/pet stats` | The state of each session |
| `/pet focus [on/off]` | Focus mode |
| `/pet size s/m/l` | Pet size |
| `/pet lang auto/zh/en` | Interface language |
| `/pet kegel` | A kegel set with it, now |
| `/pet radio` | Open the radio |
| `/pet moment [tidy\|stow]` | Demonstrate desktop care; `tidy` asks whether to sweep the desktop, and `stow` asks whether to put old files into 桌面收纳 as it sweeps |
| `/pet report` | Open today's report |
| `/pet menu` | Open the right-click menu |
| `/pet tour` | It acts out an agent's states |

Codex has no such commands; use the tray, the right-click menu or the gallery.

### Settings

Gallery → Settings (tray → Settings…): size, chattiness, quiet for a while, sound, reps per kegel set, language, approving permissions on the pet, hooking up work sources, and Claude Code usage. Changes apply at once and are written to `config.yaml`.

### Approving permissions on the pet

Off by default. Once you turn it on in the settings:

- Each time Claude Code asks for permission, a card opens above the pet: the tool, its own one-line reason, and the command it wants to run (or the file to change, or the address to reach), with three buttons: **Allow**, **Deny**, **Decide in terminal**. It answers this one request and never changes your permission rules.
- The card does not take focus, so the window you are in is not interrupted. Several requests queue up; the card's corner shows how many are left.
- **The cost**: while this is on, the terminal's own prompt waits for the card. With no click, it comes back to the terminal after the time you set (15 / 30 / 60 s, 30 by default); "Decide in terminal" sends it back at once.
- No card in fullscreen, while sharing your screen, or under the boss key: the terminal asks directly.
- The command text is handed to Rill on this machine (it is not forwarded otherwise), only to show the card, and is not stored.
- Claude Code only. Codex's hooks have no way to carry an answer back.
- When it is off, nothing changes from before: the hook returns at once and waits for nothing.

### Hotkeys

| Default | Does |
|---|---|
| `Ctrl+Alt+H` | Boss key: every pet and overlay hides and mutes at once; press again and it peeks back up |
| `Ctrl+Alt+F` | Quiet for a while (focus mode): only the status and the "waiting for you" alert |
| `Ctrl+Alt+N` | Write something down; with text selected first, it starts from that text (read through the system's accessibility interface: no clipboard, never a password box) |

Change them under `hotkeys` in `config.yaml`; they take effect after a restart.

### Hiding by itself

- **Fullscreen**: hidden while the foreground window is fullscreen (video, slides), back 3 s after it ends.
- **Screen sharing**: hidden while the "sharing" toolbar window of Tencent Meeting, Feishu, DingTalk, Zoom, Teams and others is present. If yours is not recognised, add words from that toolbar's window title or class name to `meeting.share_windows` in `config.yaml`.

## Configuration

Runtime data lives in `~/.rillbuddy/`; set `RILLBUDDY_HOME` to move it. Settings → Language and work sources → **Edit config…** opens `config.yaml`; changes apply on save.

```yaml
language: auto           # interface language: auto (follows the system) | zh | en

main_skin: zimeng        # the companion wardrobe look: zimeng | mashu | paopao | gugu | rongrong

features:
  focus_mode: false      # quiet for a while
  sounds: true           # their instruments and the alert notes
  size: m                # s | m | l (0.75× / 1× / 1.35×)
  kegel_reps: 10         # squeezes in one kegel set (3 s on, 3 s off)
  chatter: normal        # how much it says and does on its own: quiet | normal | lively
  approve: false         # answer Claude Code permission requests from a card above the pet
  approve_wait_s: 30     # how long the card waits (seconds) before the terminal asks instead

# meeting:
#   share_windows: ["Sharing"]   # extra words to recognise a meeting app's "sharing" toolbar

hotkeys:
  boss_key: Ctrl+Alt+H
  focus_toggle: Ctrl+Alt+F
  note: Ctrl+Alt+N
```

The settings page and `/pet` commands rewrite this file: keys you added yourself are kept, **comments are not** (a limit of the YAML library). Changes are validated before they are written. Keys left over from earlier versions (routing modes, pet packs and so on) are ignored without an error.

### The data folder

| Path | Holds |
|---|---|
| `config.yaml` | Configuration |
| `token`, `port` | The local API's credential and port |
| `spool/` | Events kept while Rill was not running |
| `windows.json` | Where the pets stand (back to the main screen's corner when a monitor is unplugged) |
| `rillbuddy.db` | Turns, the jar of sweets, squashed bugs, the diary, the bond (SQLite) |
| `balance.yaml`, `treats.yaml` | Optional: override built-in numbers and the kinds of sweets (names, looks, when they turn up); write only the keys you change |
| `interactions/*.yaml` | Optional: your own interaction rules; the same id overrides a built-in one, `enabled: false` turns one off |
| `bin/` | The emitter installed for Codex |
| `logs/petd.log` | The log |

Built-in defaults are in [`crates/petd/assets/`](crates/petd/assets/), with the available fields in the files' comments. Letters you have read are kept on this machine, in the app's own web storage.

## Building from source

You need Rust 1.88+, Node 18+ and WebView2 (part of Windows 10/11).

```bash
cd app && npm install && cd ..
node tools/build.mjs            # release; add --debug for a faster build
```

This builds `target/release/rillbuddy.exe` and copies `rillbuddy-emit` into `adapters/claude-code/bin/`.

For an installer: `node tools/build.mjs --bundle` produces `target/release/bundle/nsis/RillBuddy_<version>_x64-setup.exe`, with the Claude Code plugin and the emitter inside. Tauri downloads NSIS on the first build.

The npm `@tauri-apps/api` version must share its minor version with the Rust Tauri crate (both 2.11 now), or `tauri build` refuses to bundle.

### Running from source

1. Run `rillbuddy.exe` once by hand. It writes its own path to `~/.rillbuddy/petd_path`, and the emitter starts it from there whenever it is not running.
2. Hook up Claude Code with the repo as the marketplace:
   ```
   claude plugin marketplace add /path/to/rillbuddy
   claude plugin install rillbuddy@rillbuddy
   ```
3. Hook up Codex: `adapters\claude-code\bin\rillbuddy-emit.exe --install codex`, then trust the hooks with `/hooks` inside `codex`.

Claude Code copies the plugin to `~/.claude/plugins/cache/`. After a rebuild, change the version in `adapters/claude-code/.claude-plugin/plugin.json`, update the plugin, and restart Claude Code:

```
claude plugin marketplace update rillbuddy
claude plugin update rillbuddy@rillbuddy
```

Tests, debugging and contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md); implementation notes in [docs/implementation-notes.md](docs/implementation-notes.md).

## Layout

```
crates/emit/              the hook emitter (Rust, one executable), with the installers for each agent
crates/petd/              the daemon core: session state machine, one stable desktop companion, the world layer
                          (sweets, bugs), the five pets and who goes with whom (cast.rs), what
                          they do on their own and together (think.rs), how each one talks (voice.rs), the
                          bond and letters (bond.rs), config, HTTP/WS, SQLite
crates/petd/assets/       built-in balance.yaml, treats.yaml, interactions.yaml, bond.yaml
app/                      the Tauri 2 shell and the TypeScript/Canvas pages
  index.html              the one companion window
  src/rig/                the layered rigs: rig.js (pose, faces and dance moves: the lop-eared body and the upright ones), perform.js (the five instruments' scores, and the dance)
  src/skin.ts voice.ts    each pet's whole skin, and what it says in the windows
  public/rig/<pet>/       each pet's layers (zimeng, mashu, paopao, gugu, rongrong)
  public/audio/<instrument>/  instrument samples (piano, cello, flute, xylophone, harp)
  menu.html tray.html     the right-click menu, the tray panel
  shell.html              the one window the pages open in: its own frame and tab bar, each page a tab
  room.html               the room
  workbench.html          the shared isometric office workbench
  gallery.html            the gallery (pets, sweets, what it remembers, settings)
  letter.html radio.html song.html evening.html report.html welcome.html
  card.html approve.html  the hover card, the permission card
  overlay.html            the overlay (one per monitor): bugs
adapters/claude-code/     the Claude Code plugin: hooks/hooks.json, commands/pet.md, bin/
adapters/codex/ gemini/ cursor/ opencode/   each agent's mapping table
adapters/workbuddy/ deepseek-harness/       additional source adapters
design/pet-art/           the five pets' art, the layer-cutting scripts and a preview page (not in the installer)
tools/build.mjs           the build script; --bundle also creates the NSIS installer
app/tests/                 browser-side audio and coordination regression tests
docs/                     implementation notes, screenshots
```

How it works: every hook of an agent runs `rillbuddy-emit`, which sends one small event to the local daemon (`petd`, running inside the app) and exits at once, in 300 ms or less (the one exception is a permission request after you turned on approving on the pet, which waits for your click). When the daemon is not running, events go to `spool/` and are replayed on the next start. The pages read state over local HTTP and WebSocket.

## Privacy and security

- **Local only.** The daemon listens on `127.0.0.1` alone (port 47321 by default, a random free one if that is taken), and every request must carry the token in `~/.rillbuddy/token`. Three things go online: (1) with the radio open, it reads the station directory from [Radio Browser](https://www.radio-browser.info/) and plays the station you pick; (2) when you click "Pet language model" in the tray, it downloads a local model of about 390 MB from Hugging Face, for writing letters; (3) when a letter is written and the environment variable `ANTHROPIC_API_KEY` exists, the letter is written by Anthropic's API, which receives the pet's name and temper, why it is writing (such as "a couple of days ago, in the afternoon, something stayed stuck a long time and finally went through") and what it understood about you (such as "when you're stuck you'd rather try once more yourself"), with no code, file names, project names, times or the notes you wrote. Without that variable it uses the local model, or puts a letter together from ones written for each reason and each understanding, and nothing leaves the machine.
- **One number about you.** "How long you have sat" comes from the system's seconds since the last keyboard or mouse input. It reads no keys, takes no screenshots, and does not look at window contents.
- **Events carry only what is needed.** A hook hands the daemon what the pet needs: the session id, the event type, the session's working directory, the tool name, the name of a changed file and the agent's process id. Prompts, file contents and tool output are never forwarded. One exception, which you turn on yourself: approving permissions on the pet hands the command to be approved to Rill on this machine to show the card, and does not store it. Also, when a turn ends, the hook looks in the agent's last reply for the line that says "Next step: …" and hands only that line to the daemon, for 手上的事 (In hand); the rest of the reply is not forwarded.
- **Selected text is read only when you press the key.** On `Ctrl+Alt+N`, the text selected right then is read once through the system's accessibility interface, to start the note with; no clipboard, no simulated keys, never a password box.
- **Agent setup.** Claude Code uses a plugin, OpenCode uses a separate plugin file, and DeepSeek Harness loads a native event listener through its profile. Codex, Gemini CLI, Cursor and WorkBuddy setup backs up existing files and adds Rill's hooks.
- **Claude Code usage is read-only.** The numbers are what Claude Code gives its status-line command, read only after you click to hook that up; Rill does not sign in to your account or query anything online.
- **Codex quota is read-only.** It reads Codex's own session logs and changes nothing. Rill never uses a reset card for you.
- **Local system information.** To notice closed sessions, jump to a terminal, and hide in fullscreen or while sharing, the app reads this machine's process list and window titles. They are not stored or sent anywhere.

## FAQ

**Windows SmartScreen blocked the installer.**
It is not code-signed yet. Click "More info → Run anyway", or build the installer yourself.

**Codex or another source never moves.**
The desktop companion shows the highest-priority state from all connected sources. Check the workbench for the source and project that produced the state. For Codex, run `codex` in a terminal, type `/hooks`, and trust Rill's hooks. If you use more than one Codex config folder, install into each (see [Hook up Codex](#3-hook-up-codex)).

**The companion cannot be dragged.**
Install the latest Windows installer and restart RillBuddy before testing. Drag from the pet's body, then release to let it land or bounce.

**The radio or music is silent.**
Make sure Sound is enabled in the tray and Focus mode is off. Start playback from a button in the RillBuddy window, then check that Windows has not muted the app in the volume mixer. Only one source plays at a time, so another radio, song or ambience source may stop first.

**After a rebuild Claude Code still runs the old emitter.**
Claude Code runs its cached copy of the plugin. Change the plugin's version, run `claude plugin marketplace update rillbuddy` and `claude plugin update rillbuddy@rillbuddy` (or click Hook up → Claude again; it updates an installed plugin), then restart Claude Code.

**Upgrading from 0.1.33 or earlier.**
The program used to be `familiar.exe`, its data lived in `~/.familiar`, and the Claude Code plugin was `familiar@familiar`. On its first start the new version moves the data to `~/.rillbuddy` and leaves a link at the old place, so old hooks keep working. A pet then asks whether to switch Claude Code over to the new name; say yes and restart Claude Code. Codex hooks are not changed for you (they would have to be trusted again): hook up Codex again from Settings when you want them moved. The link removes itself once nothing uses the old path.

**The pets are gone.**
Check, in order: the boss key (`Ctrl+Alt+H`); a fullscreen window in front; a meeting app sharing the screen; whether you hid them (tray → Bring them back, or `/pet show`).

**Why does it never act on its own?**
See whether "Quiet for a while" is on, or "It acts on its own" is off. It also only moves once you really have sat that long, and never twice within ten minutes.

**It did not hide while I shared my screen.**
Add words from your meeting app's "sharing" toolbar window title or class name to `meeting.share_windows` in `config.yaml`.

**Double-click does not reach the exact tab.**
Windows Terminal can only be brought forward as a window, not by tab.

**Where is the log?**
`~/.rillbuddy/logs/petd.log`.

## License and assets

Code: [MIT](LICENSE).

- **Piano samples**: Salamander Grand Piano by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); see [`app/public/audio/piano/LICENSE.txt`](app/public/audio/piano/LICENSE.txt).
- **Cello samples**: "Real Cello Notes" by flcellogrl (Freesound), in the edited set from Nicholaus Brosowsky's tonejs-instruments, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); see [`app/public/audio/cello/LICENSE.txt`](app/public/audio/cello/LICENSE.txt).
- **Flute, xylophone and harp samples**: the Versilian Studios Chamber Orchestra 2 Community Edition (VSCO 2 CE, CC0), in the same edited tonejs-instruments set ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)); see the `LICENSE.txt` in each of `app/public/audio/flute/`, `xylophone/` and `harp/`.
- **The pets**: Zimeng, Mashu, Paopao, Gugu and Rongrong are original characters of this project.
- **Station directory**: [Radio Browser](https://www.radio-browser.info/); streams play straight from each station.
