---
title: "Bounty #2: From Prototype to Production"
slug: from-prototype-to-production
pubDate: 2023-08-16
heroImage: /images/2023/08/IMG_2575.jpeg
tags: ["bounties"]
---

We’re excited to launch our second bounty to encourage more devs to join the project and to ultimately bring more piggies to market.

**PROJECT: **LightningPiggy

**BOUNTY: **1,000,000 SATS  [NOW CLAIMED]

**TASK:**

- Adapt code for new LILYGO ESP32 e-paper development board, reference: T5 V2.3.1 due to obsolesce of the existing T5 2.66 board. Note the new hardware has a smaller screen area of 212x104 pixels, but is significantly cheaper.
- Boot-up image: Add a full screen start-up graphic (welcome image including an LP icon and [www.lightningpiggy.com](/) web address) for 4 seconds.
- New main screen: Update the main (always on) screen to include the following attributes:
- Total sat balance.
- Last three payments including any associated payment messages.
- LN receive QR code.
- Small Lightning Piggy icon/text and/or website address.
- Battery status (e.g. good/low/charge or no status icon if not connected).

Note: The total sats, last three payments and battery status should update independently of the other fixed screen elements.

- Shake to update: Code a ‘balance and transaction update’ interrupt on two suitable pins for an optional “shake to update” feature using an inexpensive vibration sensor, such as this one*.
- Physical buttons: Code one of buttons to restart (existing feature), and the other button to update the transaction and balance.
- Usage metrics: Include anonymous usage metrics via payment/web hooks linked with the [www.linkingpiggy.com](http://www.linkingpiggy.com) website, with the option to opt-out during configuration.

**CODING LOCATION:** https://github.com/LightningPiggy

**TIMELINE:** TWO WEEKS (TM)

---
Project: [Homepage](/) | [Donate](https://geyser.fund/project/lightningpiggy)

Build: [GitHub](https://github.com/LightningPiggy/) | [Installer](https://lightningpiggy.github.io/) | [Wiki](https://github.com/LightningPiggy/lightning-piggy/wiki)

Follow: [Nostr](https://primal.net/p/npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq) lightningpiggy@nostrplebs.com | [Twitter](https://twitter.com/lightningpiggy) | [YouTube](https://www.youtube.com/@LightningPiggyTV)