// The confirmation emails newsletter-subscribe sent in the last 24 hours, read
// back from Resend's own log of sent emails. That log is all the two limits
// in newsletter-subscribe need, so they keep no data of their own:
// - an address gets at most one confirmation a day, however often it is
//   entered on the form (a Resend idempotency key on the send covers
//   requests that arrive at the same moment);
// - about NEWSLETTER_DAILY_CAP (default 40) confirmations go out a day. It is
//   a soft cap: requests running at the same moment all see the same count,
//   so a burst can go a little over. Each confirmed signup also sends a
//   welcome email and a notification. The rest of Resend's 100 a day is left
//   for donation receipts, Nostr handle purchases and vendor applications.
// Bots have used the form to send confirmations to other people's addresses
// ("subscription bombing"), which used up that quota.

const { fetchWithRetry } = require('./newsletter-contacts');

const API = 'https://api.resend.com';
const DAY_MS = 24 * 60 * 60 * 1000;
// 1,000 emails, ten times the plan's daily quota. Past that the count so far
// is used, which is already well over any sensible cap.
const MAX_PAGES = 10;

// The form of an address the per-address limit compares: lowercased, without
// a +tag, so name+1@ and name+2@ count as one inbox. Gmail addresses arrive
// already canonical (no dots, gmail.com).
function dedupeKey(address) {
  const lower = String(address).trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at === -1) return lower;
  return lower.slice(0, at).split('+')[0] + lower.slice(at);
}

// Resend's created_at looks like '2026-10-20 20:33:46.401000+00'.
function sentAt(email) {
  const s = String((email && email.created_at) || '').replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  return Date.parse(s);
}

// { count, recipients } for the confirmations (emails with `subject`) sent in
// the 24 hours before `now`, recipients as dedupeKey()s. { busy: true } when
// Resend is still rate-limiting after the retries. null when Resend could not
// be asked or answered with something unreadable; callers then send as before.
async function recentConfirmations(apiKey, subject, now) {
  const since = now - DAY_MS;
  const headers = { Authorization: 'Bearer ' + apiKey };
  const recipients = new Set();
  let count = 0;
  let after = '';
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = API + '/emails?limit=100' + (after ? '&after=' + encodeURIComponent(after) : '');
      const res = await fetchWithRetry(url, { method: 'GET', headers });
      if (res.status === 429) return { busy: true };
      if (!res.ok) return null;
      const list = await res.json();
      if (!list || !Array.isArray(list.data)) return null;
      let oldest = Infinity;
      for (const email of list.data) {
        const t = sentAt(email);
        if (Number.isNaN(t)) return null;
        oldest = Math.min(oldest, t);
        if (t < since || email.subject !== subject) continue;
        count++;
        for (const to of email.to || []) recipients.add(dedupeKey(to));
      }
      // Newest first, so once a page reaches past the window the rest is older.
      if (!list.has_more || !list.data.length || oldest < since) return { count, recipients };
      after = list.data[list.data.length - 1].id;
    }
    return { count, recipients };
  } catch (e) {
    return null;
  }
}

module.exports = { recentConfirmations, dedupeKey };
