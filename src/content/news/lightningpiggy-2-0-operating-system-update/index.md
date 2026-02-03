---
title: Lightning Piggy v2 Operating System Update
slug: lightningpiggy-2-0-operating-system-update
pubDate: 2025-11-19
heroImage: './05F49068-65DA-401F-8119-C566D586BAA2.png'
---

🥁 Word on the farm: [MicroPythonOS](https://micropythonos.com/) 0.4.0 is out and running! [Lightning Piggy v2](/build/v2) owners, you’ll want to grab this one by the tail ⚡️🐽

Here’s the change log:

- Add custom MposKeyboard with more than 50% bigger buttons, great for tiny touch screens!
- Apply theme changes (dark mode, color) immediately after saving
- About app: add a bit more info
- Camera app: fix one-in-two "camera image stays blank" issue
- OSUpdate app: enable scrolling with joystick/arrow keys
- OSUpdate app: Major rework with improved reliability and user experience
  - add WiFi monitoring - shows "Waiting for WiFi..." instead of error when no connection
  - add automatic pause/resume on WiFi loss during downloads using HTTP Range headers
  - add user-friendly error messages with specific guidance for each error type
  - add "Check Again" button for easy retry after errors
  - add state machine for better app state management
  - add comprehensive test coverage (42 tests: 31 unit tests + 11 graphical tests)
  - refactor code into testable components (NetworkMonitor, UpdateChecker, UpdateDownloader)
  - improve download error recovery with progress preservation
  - improve timeout handling (5-minute wait for WiFi with clear messaging)

- Tests: add test infrastructure with mock classes for network, HTTP, and partition operations
- Tests: add graphical test helper utilities for UI verification and screenshot capture
- API: change "display" to mpos.ui.main_display
- API: change mpos.ui.th to mpos.ui.task_handler
- waveshare-esp32-s3-touch-lcd-2: power off camera at boot to conserve power
- waveshare-esp32-s3-touch-lcd-2: increase touch screen input clock frequency from 100kHz to 400kHz

**Credits**

- Thomas [GitHub](https://github.com/ThomasFarstrike)  [Nostr](https://primal.net/p/nprofile1qqspsyfhq487vr04z6yhvvglp06ym0jt6nfwptmfxfwla606sx5vhks9qgyxq)

Team LightningPiggy