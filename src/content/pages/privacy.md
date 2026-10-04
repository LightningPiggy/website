---
title: "Privacy Policy"
slug: "privacy"
description: "What personal data Lightning Piggy collects, publishes and shares, why, and the choices and rights you have."
pubDate: 2026-06-26
updatedDate: 2026-10-04
---

**Last updated: 4 October 2026**

This Privacy Policy explains what personal data we collect when you use the Lightning Piggy website at lightningpiggy.com (the "Website"), our BTCPay Server and LNbits at btcpay.lightningpiggy.com and lnbits.lightningpiggy.com, the Lightning Piggy hardware (the "Device"), the Lightning Piggy mobile app (the "App"), and related services (together, the "Services"). It also explains why we collect it, who we share it with, what we publish, and the choices and rights you have. It should be read together with our [Terms & Conditions](/terms).

The Services are provided by the Lightning Piggy project, a free and open-source project with volunteer contributors ("Lightning Piggy", "we", "us" or "our"). The project is in early development and is not currently incorporated as a legal entity. The maintainers who run the Website and our payment servers on the project's behalf are responsible for the personal data described in this policy (the "controller"). You can contact them about your data at **<oink@lightningpiggy.com>**.

## 1. Our approach: privacy by design

Lightning Piggy is built to collect as little personal data as possible.

- The Services use **no user accounts**. You do not register, and we do not build a profile of what you do.
- The **Device and the App connect directly to a wallet you control and to public networks** (the Bitcoin and Lightning networks and Nostr relays). They do not route your balances, transactions or activity through our servers, and **we cannot see, access or recover your keys, funds or transaction history**.
- We take most payments with **our own BTCPay Server and LNbits**, open-source software that runs on a server we manage, rather than through a payment company (see 3b for the exception).
- We do **not** sell or rent your personal data, we do **not** use advertising or cross-site tracking, and the Website sets **no tracking cookies**.

Some features are public by design. For example, the supporters wall, Nostr handles and vendor listings publish what you give them. We say so below wherever that applies.

The Website's source code and data files are kept in a **public GitHub repository**, and the Website is built from it. A maintainer also keeps a public working copy of it there. Anything we publish on the Website is also visible in these repositories, together with its change history.

## 2. When you visit the Website

### a) Hosting and server logs

The Website and its server functions are hosted by **Netlify**. As on virtually all websites, every page request reveals technical data such as your **IP address**, browser type, the page requested and the time. Netlify processes this to deliver the Website and keeps logs for a limited period that Netlify sets.

Our own server functions also write some details to these logs to help us fix problems and stop abuse. These include the Nostr handles you buy from us (see 3e), Nostr public keys, payment references and error messages. When the anti-spam checks on our newsletter and vendor-application forms reject a submission, they log the **IP address** it came from and, in some cases, the email address entered. Those two forms also count recent submissions per IP address to limit abuse. The counts are held only in the memory of the running server function and are not saved.

Our BTCPay Server and LNbits run on a server we manage, hosted by **Hostinger** in Lithuania. That server also receives your IP address and browser details when you open our point-of-sale or shop pages (which embed our BTCPay checkout), go to one of our checkouts, or switch on notifications on the Oink page. When a wallet pays our Lightning address, its request passes through Netlify to this server, so both receive it, including the wallet's IP address. The web server in front of our payment software keeps no access logs, but the payment software keeps technical logs, and the LNbits logs include IP addresses. These logs are deleted automatically, normally within three weeks.

Our legal basis for all of this is our legitimate interest in operating, securing and protecting the Services.

### b) Analytics

We use **Umami Cloud**, a privacy-friendly, **cookieless** analytics service, to understand aggregate use of the Website. When a page loads, Umami receives the full page address (including anything after a "?" or "#"), the page title, the site you came from, your screen size and your browser language. As with any web request, it also receives your IP address and browser details, which it uses to estimate your country, region and city and your browser, operating system and device type. Umami does not use cookies. It groups your page views into visits using a code calculated from your IP address and browser details, which is reset regularly, and it is not used to track you across other sites or to identify you. Our setup does not act on "Do Not Track" signals, but you can block Umami with any content blocker. Our legal basis is our legitimate interest in understanding and improving the Website.

### c) Fonts and code libraries

Our web fonts are served from the Website itself, so loading them sends nothing to Google or any other font service. A few pages load code libraries from public content delivery networks (CDNs), which receive your IP address and browser details when you open those pages: **jsDelivr** (the treasure-hunt map), **cdnjs** (the QR code tools and the Oink page) and **unpkg** (the firmware installer).

### d) Content from Nostr and other sites

Some pages show live content from the **Nostr** network, an open social network run on public servers called relays: the treasure hunt, leaderboard, market, In the Wild and #ZapMyPiggy pages. On those pages your browser connects directly to the relays and loads pictures from wherever they are hosted (for example Primal, unavatar.io or robohash.org). Those relays and image hosts receive your IP address and browser details. The homepage, the market and the supporters wall also load some profile pictures directly from Primal and unavatar.io.

The treasure-hunt pages load map tiles from **CARTO** and, only if you switch on the Bitcoin merchants layer, data from **BTC Map** and map-label fonts from MapLibre (demotiles.maplibre.org). If you use a Nostr browser extension, the treasure-hunt and leaderboard pages ask it for your list of relays when they load, and also connect to up to five of them. The firmware installer downloads firmware from our pages on **GitHub Pages**.

These pages also show other people's public Nostr profiles and posts as they appear on Nostr. For example, the treasure-hunt pages show caches and find logs, the leaderboard shows the people who have published the most treasure-hunt caches or finds, and the #ZapMyPiggy page shows recent public posts with that hashtag. Apart from the market (see 3f), this content is loaded live from Nostr, and we do not store it. To stop appearing, you can ask Nostr relays to delete your posts (not all relays do) or stop using the hashtag.

Our legal basis for these connections (2c and 2d) is our legitimate interest in providing working tools and showing community activity. You can block them with a content blocker, but some pages may then not work.

## 3. Information you choose to give us

### a) Newsletter (Freedom Farm News)

If you subscribe, we collect your **email address**. To prevent duplicate and abusive sign-ups, we store Gmail addresses in a standard form (without dots or "+" tags). We use a double opt-in: we first email you a confirmation link, which works for 48 hours and contains your address in encoded form. You are added to the list only after you click it. We then send you a welcome email and send ourselves a short notification containing your address. Your address is stored and emails are sent through our email provider, **Resend**. We use your address only to run your subscription: to send you the newsletter and related project updates, and to let us know that you have joined. We rely on your **consent**, which you can withdraw at any time using the unsubscribe link in any newsletter or by emailing us. If you unsubscribe, we stop emailing you, but your address stays in our list, marked as unsubscribed, until you ask us to delete it.

### b) Donations

You can donate on the Donate page through our **BTCPay Server**. We record the amount and, if you give them, your Nostr public key (npub) and/or X handle, which we use for the supporters wall (see 3c). We email ourselves a note of each donation with the amount and any npub or handle you gave. Our BTCPay checkout page may ask for further details, such as an email address for a refund, and anything you enter there is stored on our BTCPay Server.

You can also donate to our Lightning address **[oink@lightningpiggy.com](lightning:oink@lightningpiggy.com)**, which is handled by our **LNbits** server. It records the amount and any comment you add. If your wallet sends the payment as a Nostr "zap" (a Lightning payment linked to your Nostr profile), it includes your Nostr public key, and our LNbits server then publishes a public "zap receipt" to the Nostr relays your wallet names. The receipt contains your public key, the amount and any comment, and like other Nostr posts it cannot reliably be deleted.

**The amount and comment of each payment to this address are public.** They are shown live on our [Oink page](/oink), and in the public feed that page reads, as each payment arrives. Please do not put anything private in a comment.

Donations through **Geyser.fund** are handled entirely by Geyser under its own privacy policy.

We do not require your identity to accept a donation. Payments made on the Bitcoin blockchain are public by nature and outside our control. Lightning payments are not recorded on the blockchain, but they are routed through third-party Lightning nodes.

Our legal basis is our legitimate interest in accepting donations, keeping records of them and thanking supporters publicly on the Oink page.

### c) Supporters wall

If you donate **$50 or more** and give your npub or X handle, we look up your public profile picture (through Nostr relays or unavatar.io) and add you to the "Community Supporters" wall on the Donate page. It shows your profile picture linked to your Nostr or X profile. If you give both, both are published: the wall shows your X profile picture (its web address contains your X handle), linked to your Nostr profile. Being listed shows that you gave at least $50, but not the exact amount. Your entry (your profile picture's web address, your profile link, the date and time, and a short code made from your payment reference, which stops you being listed twice) is also saved in our public GitHub repository. We list you only with your consent, which you give by entering your npub or X handle. You can withdraw it at any time by asking us to remove you. If you do not want to be listed, leave these fields empty.

### d) Buying a case design download

When you support a case design on the [Cases page](/build/cases), we record the design, the amount and, if you give one, your **email address**. Giving an email address is optional: without one you still get your files straight after paying, but no receipt to download them again later. If you give one, it is stored with the payment on our BTCPay Server. We use it to send you a receipt with your download links (through Resend), to reply if you contact us about your purchase, and in the note we send ourselves about the purchase. It is not added to the newsletter. While you are paying, your browser keeps the address in its session storage, so that the page can confirm where your receipt is going.

**Your download links work like a key:** anyone who has one can download those files, so please keep them to yourself.

Our legal basis is performing our agreement with you (delivering your download and receipt) and our legitimate interest in keeping payment records.

### e) Nostr handles

A Nostr handle (also called a NIP-05 address) is a name like `name@lightningpiggy.com` that Nostr apps show as a verified name for your public key. If you buy one, we record the handle, your npub and the amount with the payment on our BTCPay Server, together with anything you enter on its checkout page. While you type, the handle is sent to our server to check whether it is available. Once you have paid, **your handle and Nostr public key are published** in our public directory at [lightningpiggy.com/.well-known/nostr.json](/.well-known/nostr.json), which is what makes the handle work. They are also saved in our public GitHub repository, with the handle named in the change description. We email ourselves a note with the handle, npub and amount. Our legal basis is performing our agreement with you, since publishing the handle is the service you buy.

### f) Vendor applications

If you apply to be listed on our market, we collect what you submit: your **store name, contact email, country, shop type, shipping regions, store description, reason for applying, website, and Nostr npub and/or X profile**. We also record the date and the **IP address** your application came from, to help us spot spam and abuse. We delete the IP address once we have reviewed your application. Applications are stored with our hosting provider (**Netlify**). We review them in a tool on the computer we use to manage the Website, and applications we take forward are copied there (without the IP address). We email ourselves a copy (also without the IP address) so we can review it and reply, and we send you an acknowledgement.

Applying includes agreeing that, if we approve your application, we publish your **store name, description, country, shipping regions, shop type, website, logo (usually your Nostr or X profile picture) and Nostr and X profile links** on the Website and in our public GitHub repository. Your contact email, your reason for applying and your IP address are never published. Market pages also show your public Nostr profile (name, picture, description, Nostr handle and Lightning address) and, for some vendors, your Nostr product listings. We read these from Nostr when we build the Website and again in each visitor's browser, so a change you make on Nostr reaches our saved copy only at our next update.

Our legal basis is taking steps at your request and then performing our agreement to list you, together with our legitimate interest in operating the market. You can ask us to remove your listing at any time.

### g) Shop and point-of-sale orders

Our shop and point-of-sale pages use checkout forms from our BTCPay Server. Anything the checkout asks for, such as a shipping address for a hardware order, is stored on our BTCPay Server and used to fulfil your order. To deliver a hardware order, we give your name and delivery address to the postal or courier service, and for deliveries abroad they may also be passed to customs authorities.

If you order from us through a Nostr marketplace, your order message (including your name, contact details and delivery address) is decrypted on our server and emailed to us through Resend so that we can fulfil it. Our server's logs also record your Nostr public key, the order reference, the name on the order and the items you ordered. If you send our shop's Nostr account any other direct message, the logs record only your Nostr public key. These logs are deleted automatically after a few weeks. Your order message stays on Nostr relays in encrypted form: its contents are private, but anyone can see that your Nostr public key sent us a message, and when.

Our legal basis is performing our contract with you.

### h) Treasure-hunt posts and zaps

On the treasure-hunt pages you can share a treasure or log a find on Nostr. Your Nostr browser extension signs the post, so **we never see your private key**. The post is published publicly to Nostr relays under your Nostr public key, and it cannot reliably be deleted afterwards.

If you zap a hider, a player or a market vendor, your browser contacts **their** Lightning address provider directly, and your payment goes from your own wallet. If you use a Nostr extension, the zap may include a signed request with your public key and comment, which the recipient's provider may publish to Nostr relays as a public zap receipt.

### i) Tools that run in your browser

Our QR code generators, Wi-Fi QR tool, serial monitor and firmware installer run entirely in your browser. What you type into them (including wallet connection strings and Wi-Fi passwords) and what your Device sends back over USB are **not sent to us**. The firmware installer sends Wi-Fi details only to your Device, over its USB connection.

### j) Emails and messages you send us

If you email us or contact us through our community channels, we process the information you choose to share so we can respond. Email to <oink@lightningpiggy.com> is hosted by **Namecheap Private Email**. If you send us photos, case designs or troubleshooting tips to share, we may publish them on the Website with the name you give us. Tell us if you would rather not be named. Our legal basis is our legitimate interest in replying to you and, where you send us material to share, your consent.

## 4. People and content we publish

To credit the people behind the project, the Website shows the **names, photos, short contribution notes and public profile links** of our team, contributors, Bitcoin Kids, case designers and community supporters. It also shows **testimonials** taken from posts on Nostr and in our Telegram group, **photos** of community builds that people sent us or posted on Nostr tagging Lightning Piggy, photos of workshops, the **vendors** we list on our market, and **news posts** that name people. Profile pictures come from the person's public Nostr or X profile, or from what they sent us. These are also kept in our public GitHub repository. We also keep a private list of the people and vendors we feature on the computer we use to manage the Website. It may include a role, the date added and contact details you gave us, and it is not published.

Our legal basis is our legitimate interest in crediting contributors and showing community activity, or your consent where you sent us the material. If you appear in this content and want your details changed or removed, email us and we will update or remove them. Content loaded live from Nostr (see 2d) is not published by us in this way.

## 5. What we do not collect

We never collect, and the Device and App never transmit to us, your **private keys, seed phrases, PINs, wallet balances or transaction history**. We do not build advertising profiles, and we do not sell your data.

## 6. Cookies and browser storage

Pages on lightningpiggy.com do not set cookies. They use your browser's storage only where a feature needs it:

- **Session storage** holds your email address while you buy a case design download (see 3d). It is cleared once your payment is confirmed, or when you close the tab.
- Umami checks local storage for a setting that switches analytics off. It does not store anything there itself.

Our BTCPay Server (btcpay.lightningpiggy.com), which also loads inside our point-of-sale and shop pages, may use cookies and local storage that it needs for checkout and for your shopping cart.

## 7. Who we share data with

We share personal data with these service providers, which act on our behalf (what we publish is described in sections 3 and 4, and the profile-picture lookup in 3c):

- **Netlify**: hosts the Website and its server functions and logs, and stores vendor applications.
- **Resend**: sends our emails and holds the newsletter list.
- **Umami**: analytics (see 2b).
- **Hostinger**: provides the server, in Lithuania, that runs our BTCPay Server and LNbits and handles orders from Nostr marketplaces.
- **GitHub**: hosts our public code repository, including the data we publish on the Website.
- **Namecheap Private Email**: hosts our <oink@lightningpiggy.com> mailbox.

If you order hardware, we also give your delivery details to the postal or courier service that delivers it. When you use certain features, your browser also connects directly to independent third parties, such as Nostr relays, image hosts, CDNs, map providers and other people's Lightning address providers (see sections 2 and 3). They are not our processors, and their own privacy policies apply. We may also disclose information if required by law, to enforce our Terms, or to protect the rights, safety and security of our users or the Services. Public networks (Bitcoin, Lightning, Nostr) are public by design and are not our processors.

## 8. International transfers

Some of our providers process data outside your country, including outside the European Economic Area (EEA). Netlify, Resend and GitHub, for example, are based in the United States. Where that happens, we rely on appropriate safeguards (such as the providers' standard contractual clauses or equivalent mechanisms) to protect your data. Our payment server is hosted in the European Union.

## 9. Data retention

We keep personal data only as long as needed for the purpose it was collected:

- **Newsletter:** your email address stays on our list until you unsubscribe. After that we keep it, marked as unsubscribed, so that we do not email you again. Email us if you want it deleted completely, including from our sign-up notifications.
- **Payments:** payment records on our BTCPay Server and LNbits, including any email address, delivery address, npub, handle or comment given with them, are kept as our record of payments and so that download links keep working. We do not delete them automatically. Once your order is complete, you can ask us to remove your email or delivery address.
- **Vendor applications:** if we decline an application, we delete it, including the copy emailed to us. We delete the IP address once we have reviewed an application. If we accept one, we keep it as a record of your listing, and delete it on request.
- **Published content:** we keep it on the Website until it is removed, at your request or ours.
- **Our private list of featured people and vendors:** kept while we feature you, and updated or deleted on request.
- **Logs and analytics:** Netlify and Umami keep logs and analytics for limited periods that they set. Our own server's technical logs, including the LNbits logs with IP addresses, are deleted automatically, normally within three weeks (see 2a and 3g).
- **Emails:** emails you send us, and the notifications our systems send us about sign-ups, donations, purchases, orders and vendor applications, are kept in our mailbox only as long as we need them, and we delete them on request. Resend, our email provider, keeps copies of the emails we send for a limited period that it sets.

## 10. Your rights

Depending on where you live, you may have the right to access, correct or delete your personal data, to restrict or object to how we use it, to receive a copy in a portable format, and to withdraw your consent at any time. Withdrawing consent does not affect anything we did before you withdrew it. To exercise these rights, email **<oink@lightningpiggy.com>**. You can unsubscribe from the newsletter at any time using the link in our newsletters. If you are in the EEA or UK and believe we have mishandled your data, you also have the right to complain to your local data-protection authority.

Please note the limits of what we can remove. We can take your details off the Website, but earlier versions remain in the history of our public GitHub repositories (including a maintainer's working copy), in earlier deploys kept by Netlify until we delete them, and in any copies others have made. We cannot delete posts published to Nostr, including zap receipts, or transactions recorded on the Bitcoin blockchain.

## 11. Children's privacy

The Services are intended to be set up and supervised by a parent or legal guardian (see our [Terms & Conditions](/terms)). Because the Services use no accounts, we do not knowingly collect personal data directly from children. If you believe a child has provided us with personal data (for example, by emailing us or submitting a form), contact us and we will delete what we can (see section 10). Some pages name or show young people, sometimes with their age: the Bitcoin Kids page and credits, case-design credits, some news posts, community and workshop photos, and Character Design Challenge entries. We publish a young person's name, photo or age only with the agreement of their parent or legal guardian. If you are a parent or legal guardian, or the young person concerned, and would like any of these removed, contact us and we will remove them from the Website (see section 10 for copies we cannot remove).

## 12. Security

We take reasonable technical and organisational measures to protect the limited data we hold. However, no method of transmission or storage is completely secure, and we cannot guarantee absolute security. Remember that the security of your **wallet, keys and funds** is your responsibility and is governed by your chosen wallet provider, not by us.

## 13. Third-party services

The Services also link to and work with independent third parties, such as wallet providers, app stores, Nostr relays and Geyser.fund. Their own privacy policies apply to how they handle your data, and we encourage you to read them. We are not responsible for their privacy practices. This does not cover the service providers listed in section 7, which handle data on our behalf.

## 14. Changes to this policy

We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date above. Significant changes will be made clear on this page.

## 15. Contact

For any privacy question or request, contact us at **<oink@lightningpiggy.com>**.
