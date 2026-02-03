---
title: Software Update v6.2.0
slug: software-update-v6-2-0
pubDate: 2025-04-30
heroImage: './5D57CD42-D8F7-4775-92BC-E6CAEEA4469A.png'
tags: ["news"]
---

While fiat savers are wallowing in the mud, LightingPiggy keeps on shipping!

Check out our latest v6.2.0 update, it’s a meal of new user experience improvements.

For starters, the device now displays the exact day and time it last checked your wallet; updated every minute in "no_sleep" mode.

Talking of “no_sleep” mode, for main course, you can now choose the vibe that suits your power source:

- "no_sleep" – always awake (great for mains, solar, and big batteries)

- "custom_sleep" – default 6-hour snooze (perfect for batteries, solar and custom set-ups)

- "endless_sleep" – deep hibernation with shake-to-wake (perfect for small batteries!)

Here’s the full change log:

**User Experience (UX) Improvements**

- Detailed startup feedback: The device now shows real-time status updates during startup (e.g. connecting to Wi-Fi, syncing time, launching webserver, fetching wallet data).

- Always-on clock display: The current time is now continuously shown while the device is powered on, not just before going to sleep.

- Localized weekday names: Weekday names are once again translated into your local language.

- Configurable sleep modes *(Feature Request #35) detailed above.*

- Last wallet check timestamp: The device now shows the date and time it last checked your wallet (updates every minute in no_sleep mode).

**Fixes & System Enhancements**

- Switched to standard NTP: All time synchronization now uses pool.ntp.org, removing the dependency on timeapi.io.

- Automatic Wi-Fi reconnection: The device will now attempt to reconnect automatically if Wi-Fi is lost.

- Periodic auto-restart: The device now performs a daily (every 23 hours) restart to proactively avoid potential issues.

- Cross-platform build support: The same firmware build now runs seamlessly on both physical and virtual (QEMU) ESP32 devices—no recompilation needed.

You can install it using the **Web Installer**, which has now hit a milestone—**no known open issues**! 

If you’re already on version **5.x or later**, your existing configuration will be preserved during the upgrade.

Enjoy the update! Stay humble, hog sats!

**Credits**

- Thomas [GitHub](https://github.com/ThomasFarstrike)  [Nostr](https://primal.net/p/nprofile1qqspsyfhq487vr04z6yhvvglp06ym0jt6nfwptmfxfwla606sx5vhks9qgyxq)

Team LightningPiggy

[http://www.lightningpiggy.com](/)

LightingPiggy is an electronic cash piggy bank for children, that accepts Bitcoin sent over the Lightning Network. It displays payment amounts, messages, and the total satoshis saved.

Our vision is to make bitcoin the savings’ standard for every child, while creating an educational platform to inspire future generations, not only to save in bitcoin, but also to learn to code and build in a free and open-source way.

Build your own: [https://www.lightningpiggy.com/build/](/build/v1)

Chat with our community: [https://t.me/LightningPiggy](https://t.me/LightningPiggy)

Join our shadowy super coders: [https://github.com/LightningPiggy](https://github.com/LightningPiggy)

Support the project: [https://geyser.fund/project/lightningpiggy](https://geyser.fund/project/lightningpiggy)

Follow us on Nostr: [https://njump.me/npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq](https://njump.me/npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq)

Follow us on X: [https://twitter.com/lightningpiggy](https://twitter.com/lightningpiggy)