# >_ Lounge

> A terminal session manager for SSH servers, local shells, and AI agent workflows.

Lounge is not just a terminal emulator.  
It's a persistent workspace where your servers, projects, and agents are always ready to connect.

Like an airport lounge — where agents wait, connections stay warm, and work begins the moment you arrive.

<br />

## Features

### Session Management
- **Saved profiles** — Store SSH servers and local terminals by name
- **Auto-connect** — Open designated sessions automatically on startup
- **Collapsible sidebar** — Three states: expanded, icons-only, hidden
- **Persistent storage** — SQLite-backed profiles survive restarts

### SSH
- Password, private key, and key file path authentication
- Automatic `keyboard-interactive` handling (Ubuntu, Debian, etc.)
- Save and instantly reconnect to any server

### Local Terminal
- Set a start directory per profile (one terminal per project)
- Folder browse dialog for quick path selection

### Quality of Life
- `Ctrl+C` — copies selected text; sends SIGINT when nothing is selected
- `Ctrl+V` / right-click — paste from clipboard
- Desktop notification when a long-running command finishes (> 5s)
- CJK IME input support

<br />

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| UI | React + Vite |
| Terminal | xterm.js |
| SSH | ssh2 |
| PTY | node-pty (ConPTY) |
| DB | better-sqlite3 |

<br />

## Getting Started

```bash
npm install
npm run dev
```

> **Windows recommended** — uses node-pty's ConPTY backend for best compatibility.

### Building

```bash
# Requires Windows Developer Mode enabled (for symlink support)
set CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist
```

Outputs to `release/`:
- `Lounge Setup x.x.x.exe` — NSIS installer
- `Lounge x.x.x.exe` — portable executable

<br />

## License

MIT © [duskagk](https://github.com/duskagk)
