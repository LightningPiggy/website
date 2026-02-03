---
title: Software Update V4.3.x
slug: whats-new-rollup-of-recent-changes-made-up-to-v4-3-x
pubDate: 2024-06-17
heroImage: './2024-06-17-19-07.jpeg'
tags: ["news"]
---

This is no boar-ing tale…. We’re happy to announce the release of Lightning Piggy version 4.3.x! Here’s the change log.

## User Experience Improvements

- Display all incoming payments for the wallet, including non-LNURL payments that come in through a regular invoice.
- Show battery as percentage instead of voltage.
- Reduce “Tilted!” time after tilt from 5 seconds to 2.
- Refresh display when device is tilted (if tilt sensor is present between pin 32 and 3V3).
- Add support for alternative LNBits HTTPS port configuration (instead of default 443).
- Refresh balance and payments every 15 minutes to enhance resilience against server disconnections and network glitches.
- Improve “Unknown Balance” error display.
- Improve watchdog reset timing.

## User Interface Improvements

- Only show battery info when a battery is detected; absence of info implies no battery detected.
- Do not show hardware info on-screen to conserve valuable screen space.

## Fixes

- Fix erroneous usage of LNBits HTTPS port for non-LNBits hosts.
- Fix crash when attempting to request time from network when network is not connected.
- Ensure compilation works on both arduino-esp 2.x and 3.x.
- Fix bug causing incoming payments not to show up when starting with an empty wallet.
- Feed watchdog while retrying HTTPS connections to prevent it from thinking the device is hanging and restarting.
- Fix long number formatting.
- Flag balance and payments for refresh when WiFi (re)connects to clear display of any error messages.
- Retry SSL (HTTPS) connections up to 3 times in case of failure.
- Fix potential websocket handler race condition.

Credits: [Thomas](https://github.com/ThomasFarstrike?ref=lightningpiggy.com)