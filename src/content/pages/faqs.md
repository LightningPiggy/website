---
title: FAQs
slug: faqs
pubDate: 2023-04-27
---

### Where are the bitcoin stored?

Unlike a traditional piggy bank, they're not "inside the piggy." They live in the wallet you connect to it. If someone ran off with your Lightning Piggy and you'd connected a watch-only wallet, the most they could do is see your balance, recent transactions, and the address used to receive bitcoin. Your funds stay safe in the wallet you control.

### Does Lightning Piggy custody funds?

Absolutely not, and we don't want to. Lightning Piggy is an open-source project run by volunteers. The device simply connects to a wallet of your choice. As bitcoiners, we live by "not your keys, not your coins," so we recommend a self-custodial wallet wherever possible.

That said, we understand the tradeoffs with pocket-money sized amounts, especially when it comes to ease and speed. A custodial wallet can be a reasonable choice if the balance is small, or if you set up an auto-sweep to cold storage. Some custodial wallets have this feature baked in, such as in the case of [CoinOS](https://coinos.io).

### Why choose to prioritise bitcoin payments over lightning, instead of the main chain?

When deciding whether to start with Bitcoin on the main chain (Layer 1) or the Lightning Network (Layer 2), we opted for the latter due to its advantages in near-instant settlement, ultra-low fees independent of transaction fee fluctuations, and the ease with which senders can attach messages to their transactions.

Lightning Piggy is tailored for small, routine transactions such as pocket money, and rewards for homework or housework. While integrating the ability to accept Bitcoin on the main chain would enhance our offering by providing a more secure option for long-term savings for kids, it remains a desirable addition for future updates.

### Why "Lightning Piggy", and not "Bitcoin Piggy"?

Bitcoin Piggy would also be a great name for the project. However, Lightning Piggy fits better for two reasons:

1. The piggy is designed for handling small amounts, such as for pocket money and homework/housework task payments, meaning its design is lightning network native and therefore part of his pedigree.
2. Lightning Piggy has his life to thank for escaping the fiat money system when the truck he was travelling in got struck by lightning and crashed on the way to the abattoir. It's a harrowing story where he was chased into a forest, only evading capture by diving down a bottomless rabbit hole. During his time down the hole he meets lots of interesting characters who showed him the way to freedom.

### Does Lightning Piggy support Tor?

The device itself doesn't run over Tor but it could theoretically, since Tor seems to have been ported to the ESP32. However, we believe it wouldn't be trivial to implement and performant to run.
