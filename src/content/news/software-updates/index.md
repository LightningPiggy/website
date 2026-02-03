---
title: Software Updates V2.1.1 & V2.0.0
slug: software-updates
pubDate: 2024-03-19
heroImage: './LightningPiggy-Character-Design-Challenge-page-14.jpeg'
tags: ["news"]
---

We’re thrilled to formally announce two updates to the Lightning Piggy code. The first a major update (v2) launched at the Bitcoin Atlantis conference in Madeira earlier this month. And the second update (V2.1.1) with minor improvements released a few days ago.

**What’s new with V2.1.1**

User experience improvements:

- Support for CHF currency symbol (Fr).
- Support for German, Dutch and Spanish weekdays.
- Additional boot slogans.
- Only the first character of weekdays will be displayed.

Fixes

- Display artefacts below horizontal line removed.
- “NA" placeholder for unknown currency symbols removed.

Credit: [https://github.com/ThomasFarstrike](https://github.com/ThomasFarstrike)

**What’s new with V2.0.0**

Extended battery life:

- Infinite wifi retry, infinite HTTP response waiting time and other long battery-draining exceptions are addressed with a "smart" watchdog.
- The wake-up frequency now adapts based on a seven-point profile correlated with battery voltage.

User experience improvements:

- Realtime balance and payment updates also happen under battery power after manual wake-ups, thanks to new awake/sleep status decision logic.
- Notification code enhancements that help the user to easily troubleshoot any possible errors.
- On-screen indication when the device is sleeping vs awake.
- New on-screen software update visibility.
- New startup screen logo by Bitko.

Optional new features:

- Fiat balance and Bitcoin price with configurable fiat currency (USD, EUR, DKK,...)
- Random boot-up 'quotes and memes' with configurable prelude.
- Show last updated day and time.

Removed features:

- Disabled HAL sensor value as it wasn't useful.

Credits: [https://github.com/ThomasFarstrike](https://github.com/ThomasFarstrike) with valuable new feature and improvement contributions from [https://github.com/lonerookie](https://github.com/lonerookie)

Team LightningPiggy

---
LightingPiggy is an electronic cash piggy bank for children, that accepts bitcoin sent over lightning while displaying the amount saved in satoshis.

Our vision is to make bitcoin the savings’ standard for every child, while creating an educational platform to inspire future generations, not only to save in bitcoin, but also to learn to code and build in a free and open source way.

[Build](/build/v1) your own  

Chat with our [community](https://t.me/LightningPiggy)  

Join our [shadowy super coders](https://github.com/LightningPiggy)  

[Support](https://geyser.fund/project/lightningpiggy) the project  

Follow us on [Nostr](https://njump.me/npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq)  

Follow us on [X](https://twitter.com/lightningpiggy)