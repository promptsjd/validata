# Validata

**The research notebook that lives inside Reddit.**

Most tools that pull Reddit data are built for scale — thousands of posts, bulk exports, API quotas, paid plans. Validata is built for the opposite: the researcher who is *reading* Reddit, making judgment calls about what matters, and building a curated dataset one insight at a time.

Browse any subreddit naturally. Capture the posts and comments worth keeping. Export when you're done. No account. No API key. No usage limits. No subscription. Your data never leaves your browser.

---

## Why Validata

- **Qualitative, not quantitative** — you decide what gets captured, not an algorithm
- **No account required** — open it and start working
- **No limits** — capture as much or as little as you want
- **Fully offline** — everything stays on your machine; nothing is sent anywhere
- **Free to use** — no plan required to access your own research

---

## Features

- **Projects** — organize captures into named research projects
- **Session-based capture** — start a session on any Reddit page; posts are captured automatically as you browse
- **Comment capture** — hover to highlight, click to save individual comments
- **Flexible capture settings** — toggle timestamp, post link, and comment capture per project
- **Default settings** — save your preferred capture options so every new project starts the way you work
- **Export** — download your data as CSV (spreadsheet-ready) or JSON (full fidelity with project metadata)

---

## How to Use

1. Click the Validata icon in your Chrome toolbar to open the side panel
2. Create a new project and configure your capture settings
3. Select the project and click **Start Session**
4. Browse Reddit — posts are captured automatically; click highlighted comments to save them
5. Click **Stop Session** when done
6. Export your data from the project's context menu (⋮)

---

## Installation

### From the Chrome Web Store
Search for **Validata** and click **Add to Chrome**.

### From Source
1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Saves projects and captured data locally on your device |
| `sidePanel` | Opens the Validata panel alongside Reddit |
| `scripting` | Injects the capture overlay into Reddit pages |
| `tabs` | Identifies the active Reddit tab when starting a session |
| `https://*.reddit.com/*` | Limits capture to Reddit pages only |

---

## Privacy

Validata operates entirely locally. It does not collect, transmit, or store any data outside your browser. All captured content remains in Chrome's `storage.local` and is deleted when you clear the project or uninstall the extension.
[Read the full privacy policy](https://promptsjd.github.io/validata/PRIVACY)

---

## License

MIT
"# validata" 
