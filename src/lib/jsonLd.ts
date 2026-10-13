// jsonLd.ts
// Serialise data for an inline <script type="application/ld+json"> block.
// JSON.stringify leaves `<` as-is, so a string containing `</script>` (e.g. a
// vendor's Nostr product title) would close the block early and inject HTML.
// Escaping `<` as \u003c keeps the JSON identical once parsed but means the
// HTML parser can never see `</script` or `<!--` inside the block. U+2028 /
// U+2029 are escaped too, as they are line terminators in older JS parsers.

export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
