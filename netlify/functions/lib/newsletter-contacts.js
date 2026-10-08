// Where an address stands with the newsletter, shared by newsletter-subscribe
// and newsletter-confirm.
//
// Resend keeps one contact per address for the whole account, with a single
// "unsubscribed" flag, and the newsletter is one segment of those contacts.
// So "on the list" means: a contact exists, it is not unsubscribed, and it is
// in the newsletter segment.

const API = 'https://api.resend.com';

// Fetch with exponential backoff on 429 rate limits (600 ms, 1.2 s, 2.4 s).
async function fetchWithRetry(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  let delay = 600;
  let res;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetch(url, options);
    if (res.status !== 429 || attempt === maxRetries) return res;
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  return res;
}

// 'subscribed' | 'unsubscribed' | 'not-on-list' | 'new', or null when Resend
// could not be asked (callers then carry on as for a new address).
async function newsletterStatus(apiKey, email, segmentId) {
  try {
    const headers = { Authorization: 'Bearer ' + apiKey };
    const id = encodeURIComponent(email);
    const res = await fetchWithRetry(API + '/contacts/' + id, { method: 'GET', headers });
    if (res.status === 404) return 'new';
    if (!res.ok) return null;
    const contact = await res.json();
    if (contact.unsubscribed === true) return 'unsubscribed';
    if (!segmentId) return null;
    const segs = await fetchWithRetry(API + '/contacts/' + id + '/segments', { method: 'GET', headers });
    if (!segs.ok) return null;
    const list = await segs.json();
    if (!list || !Array.isArray(list.data)) return null;
    return list.data.some((s) => s && s.id === segmentId) ? 'subscribed' : 'not-on-list';
  } catch (e) {
    return null;
  }
}

module.exports = { fetchWithRetry, newsletterStatus };
