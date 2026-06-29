# Privacy Policy

**Effective date:** June 29, 2026

---

## Overview

Validata is a browser extension that helps you capture and organize Reddit content for personal research. This policy explains what data the extension touches, where it goes, and what happens to it.

The short version: everything stays on your device. Validata does not collect, transmit, or share any data with anyone — including us.

---

## What Data Validata Accesses

When you use Validata during a browsing session on Reddit, the extension reads:

- The text content of Reddit posts and comments you choose to capture
- Post titles, URLs, and timestamps from pages you visit while a session is active
- No login information, account details, or personal identifiers are accessed or stored

---

## Where Your Data Is Stored

All data captured by Validata is stored exclusively in your browser using Chrome's `storage.local` API. This storage:

- Exists only on your device
- Is not synced to Chrome's cloud sync
- Is not accessible to any website, server, or third party
- Is permanently deleted when you clear a project, or when you uninstall the extension

---

## What Data Leaves Your Device

**None.** Validata makes no network requests. It has no backend server, no analytics, no crash reporting, and no telemetry of any kind. The extension operates entirely offline after installation.

---

## Third-Party Services

Validata does not integrate with any third-party services. No data is sent to advertising networks, analytics platforms, or any external service.

---

## Permissions Explained

Validata requests the following Chrome permissions:

| Permission | Purpose |
|---|---|
| `storage` | Saves your projects and captured data locally on your device |
| `sidePanel` | Opens the Validata panel alongside Reddit in your browser |
| `scripting` | Injects the capture interface into Reddit pages during an active session |
| `tabs` | Identifies the active Reddit tab when you start a session |
| `https://*.reddit.com/*` | Restricts all extension activity to Reddit pages only |

No permission is used for any purpose beyond what is described above.

---

## Children's Privacy

Validata is not directed at children under 13 and does not knowingly collect any information from children.

---

## Changes to This Policy

If this policy changes, the updated version will be published at this URL with a new effective date. Continued use of the extension after a change constitutes acceptance of the updated policy.

---

## Contact

If you have questions about this privacy policy, open an issue at the project's GitHub repository.
