---
title: Software Update V3.0.3
slug: v303
description: "Firmware v3.0.3 adds near-instant payment alerts over a websocket, stays awake after each payment and fixes display, battery and timeout bugs."
seoTitle: "Classic Firmware v3.0.3 Release Notes"
heroImageAlt: "Handmade red and blue card model of Lightning Piggy"
category: software-update
pubDate: 2024-03-30
heroImage: './IMG_3356.jpeg'
tags: ["news"]
---

Hot on the hoofs of V2.1.1 we’re thrilled to announce another update to the Lightning Piggy code.

## What’s new

User Experience Improvements

- Near instant payment recognition while awake thanks to the introduction of a websocket.
- Enhanced alertness to successive payments by resetting the awake timer after each payment is received.
- Improve timeout behaviour in HTTPS fetcher.

User Interface Improvements

- Improve display code.

Under The Hood Improvements

- Upgrade ESP32 Board Support version to 2.0.14.
- Improve stability and reduce backend load by avoiding frequent polls.
- Remove unused libraries for smaller files size and faster flashing,

Fixes

- Fixed tilda character causing big blank space on display.
- Fix partially blank timestamp on display.
- Fix rare hang in chunked HTTPS fetcher.
- Fix battery voltage glitch causing unnecessary sleeps.
- Fix watchdog timeout configuration logic.

Credit: [https://github.com/ThomasFarstrike](https://github.com/ThomasFarstrike)

Team Lightning Piggy


---
Lightning Piggy is an electronic cash piggy bank for children, that accepts bitcoin sent over lightning while displaying the amount saved in satoshis.

Our vision is to make bitcoin the savings’ standard for every child, while creating an educational platform to inspire future generations, not only to save in bitcoin, but also to learn to code and build in a free and open source way.

[Build](/build/classic/) your own

Chat with our [community](https://t.me/LightningPiggy)  

Join our [shadowy super coders](https://github.com/LightningPiggy)  

[Support](https://geyser.fund/project/lightningpiggy) the project  

Follow us on [Nostr](https://njump.me/npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq)  

Follow us on [X](https://twitter.com/lightningpiggy)
