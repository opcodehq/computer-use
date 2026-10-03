# Changelog

## Unreleased

- Add a macOS backend for the shared desktop broker through the permission-owning Opcode helper.
- Add scoped multiplayer presence, named cursor overlays, participant lists, and explicit input handoff for people and agents.
- Add private sharing credentials, HTTPS clients, and OpenSSH tunnels with verified forwarding readiness.
- Publish agent presence automatically through MCP; preserve uncertain input outcomes and held-input recovery across failures.
- Add remote-access, multiplayer HTTP/browser, and Mac transport tests, plus cross-platform verification CI.


## 0.3.0 — 2026-10-03

- Add a shared Linux X11 desktop service with full-display and window capture, input, and attachment to existing displays.
- Add scoped viewer access, a display-wide control lease, human takeover, stale-observation checks, cancellation, and lifecycle invalidation.
- Add headless H.264 recording with pause/resume, download, exact byte limits, duration limits, and interrupted-recording recovery.
- Add CLI, MCP image responses, an embedding API, a reverse-proxy example, and Zuse integration documentation.
- Support minimal Node installation without model SDKs, detector/OCR packages, model downloads, or API keys. Existing optional agent/browser features remain available through the default install.
- Improve native gesture cleanup and Unicode terminal paste. Explain missing resize dependencies and hide input controls for read-only viewers.

Validated with repository tests and the installed package on a disposable Linux desktop, including real terminal input, viewer control, MCP ownership, and video playback. Live Boat, boxd, E2B and Mac qualification of the new service is not included. Resizing depends on the display's supported modes; the viewer uses PNG polling.
