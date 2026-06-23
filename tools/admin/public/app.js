// --- Tab Switching ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// --- Wild Photo Upload ---
const dropzone = document.getElementById('wild-dropzone');
const wildFile = document.getElementById('wild-file');
const wildPreview = document.getElementById('wild-preview');
const wildPreviewImg = document.getElementById('wild-preview-img');
const wildPreviewInfo = document.getElementById('wild-preview-info');
const wildUploadBtn = document.getElementById('wild-upload-btn');
const wildResult = document.getElementById('wild-result');

let selectedWildFile = null;

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) showWildPreview(e.dataTransfer.files[0]);
});

wildFile.addEventListener('change', () => {
  if (wildFile.files[0]) showWildPreview(wildFile.files[0]);
});

function showWildPreview(file) {
  selectedWildFile = file;
  const url = URL.createObjectURL(file);
  wildPreviewImg.src = url;
  wildPreviewInfo.textContent = `${file.name} - ${(file.size / 1024).toFixed(0)}KB`;
  wildPreview.hidden = false;
  wildUploadBtn.hidden = false;
  wildResult.hidden = true;
}

wildUploadBtn.addEventListener('click', async () => {
  if (!selectedWildFile) return;
  wildUploadBtn.disabled = true;
  wildUploadBtn.textContent = 'Uploading...';

  const formData = new FormData();
  formData.append('image', selectedWildFile);

  try {
    const resp = await fetch('/api/wild/upload', { method: 'POST', body: formData });
    const data = await resp.json();

    if (data.success) {
      wildResult.className = 'result success';
      wildResult.innerHTML = `Saved as <strong>${data.filename}</strong> (${data.size})`;
    } else {
      wildResult.className = 'result error';
      wildResult.textContent = data.error;
    }
  } catch (err) {
    wildResult.className = 'result error';
    wildResult.textContent = err.message;
  }

  wildResult.hidden = false;
  wildUploadBtn.disabled = false;
  wildUploadBtn.textContent = 'Upload & Optimize';
});

// --- Wild Gallery ---
const wildGallery = document.getElementById('wild-gallery');
const wildLightbox = document.getElementById('wild-lightbox');
const wildLightboxImg = document.getElementById('wild-lightbox-img');

async function loadWildGallery() {
  try {
    const resp = await fetch('/api/wild/list');
    const images = await resp.json();
    wildGallery.innerHTML = '';
    if (images.length === 0) {
      wildGallery.innerHTML = '<p style="color:#999;grid-column:1/-1;">No wild images yet.</p>';
      return;
    }
    images.forEach(img => {
      const card = document.createElement('div');
      card.style.cssText = 'position:relative; border-radius:8px; overflow:hidden; border:1px solid #e5e7eb; background:#f9fafb;';
      card.innerHTML = `
        <img src="${img.path}" alt="${img.filename}" style="width:100%; aspect-ratio:1; object-fit:cover; cursor:pointer; display:block;" data-full="${img.path}">
        <div style="padding:6px 8px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; color:#666;">${img.filename}<br>${img.size} · ${img.modified ? new Date(img.modified).toLocaleDateString() : ''}</span>
          <button data-filename="${img.filename}" style="background:#ef4444; color:white; border:none; border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer;">Delete</button>
        </div>
      `;
      card.querySelector('img').addEventListener('click', () => {
        wildLightboxImg.src = img.path;
        wildLightbox.style.display = 'flex';
      });
      card.querySelector('button').addEventListener('click', async (e) => {
        const filename = e.target.dataset.filename;
        if (!confirm(`Delete ${filename}?`)) return;
        const resp = await fetch(`/api/wild/${filename}`, { method: 'DELETE' });
        if (resp.ok) loadWildGallery();
      });
      wildGallery.appendChild(card);
    });
  } catch (err) {
    wildGallery.innerHTML = `<p style="color:red;">Failed to load gallery: ${err.message}</p>`;
  }
}

wildLightbox.addEventListener('click', () => { wildLightbox.style.display = 'none'; });

const wildResultEl = document.getElementById('wild-result');
const wildResultObserver = new MutationObserver(() => {
  if (wildResultEl.classList.contains('success')) loadWildGallery();
});
wildResultObserver.observe(wildResultEl, { attributes: true, attributeFilter: ['class'] });

// Load wild gallery on page load (default tab)
loadWildGallery();

// --- Showcase Photo Upload ---
const showcaseDropzone = document.getElementById('showcase-dropzone');
const showcaseFile = document.getElementById('showcase-file');
const showcasePreview = document.getElementById('showcase-preview');
const showcasePreviewImg = document.getElementById('showcase-preview-img');
const showcasePreviewInfo = document.getElementById('showcase-preview-info');
const showcaseUploadBtn = document.getElementById('showcase-upload-btn');
const showcaseResult = document.getElementById('showcase-result');

let selectedShowcaseFile = null;

showcaseDropzone.addEventListener('dragover', e => { e.preventDefault(); showcaseDropzone.classList.add('dragover'); });
showcaseDropzone.addEventListener('dragleave', () => showcaseDropzone.classList.remove('dragover'));
showcaseDropzone.addEventListener('drop', e => {
  e.preventDefault();
  showcaseDropzone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) showShowcasePreview(e.dataTransfer.files[0]);
});

showcaseFile.addEventListener('change', () => {
  if (showcaseFile.files[0]) showShowcasePreview(showcaseFile.files[0]);
});

function showShowcasePreview(file) {
  selectedShowcaseFile = file;
  const url = URL.createObjectURL(file);
  showcasePreviewImg.src = url;
  showcasePreviewInfo.textContent = `${file.name} - ${(file.size / 1024).toFixed(0)}KB`;
  showcasePreview.hidden = false;
  showcaseUploadBtn.hidden = false;
  showcaseResult.hidden = true;
}

showcaseUploadBtn.addEventListener('click', async () => {
  if (!selectedShowcaseFile) return;
  showcaseUploadBtn.disabled = true;
  showcaseUploadBtn.textContent = 'Uploading...';

  const formData = new FormData();
  formData.append('image', selectedShowcaseFile);

  try {
    const resp = await fetch('/api/showcase/upload', { method: 'POST', body: formData });
    const data = await resp.json();

    if (data.success) {
      showcaseResult.className = 'result success';
      showcaseResult.innerHTML = `Saved as <strong>${data.filename}</strong> (${data.size})`;
    } else {
      showcaseResult.className = 'result error';
      showcaseResult.textContent = data.error;
    }
  } catch (err) {
    showcaseResult.className = 'result error';
    showcaseResult.textContent = err.message;
  }

  showcaseResult.hidden = false;
  showcaseUploadBtn.disabled = false;
  showcaseUploadBtn.textContent = 'Upload & Optimize';
});

// --- Showcase Gallery ---
const showcaseGallery = document.getElementById('showcase-gallery');
const showcaseLightbox = document.getElementById('showcase-lightbox');
const showcaseLightboxImg = document.getElementById('showcase-lightbox-img');

async function loadShowcaseGallery() {
  try {
    const resp = await fetch('/api/showcase/list');
    const images = await resp.json();
    showcaseGallery.innerHTML = '';
    if (images.length === 0) {
      showcaseGallery.innerHTML = '<p style="color:#999;grid-column:1/-1;">No showcase images yet.</p>';
      return;
    }
    images.forEach(img => {
      const card = document.createElement('div');
      card.style.cssText = 'position:relative; border-radius:8px; overflow:hidden; border:1px solid #e5e7eb; background:#f9fafb;';
      card.innerHTML = `
        <img src="${img.path}" alt="${img.filename}" style="width:100%; aspect-ratio:1; object-fit:cover; cursor:pointer; display:block;" data-full="${img.path}">
        <div style="padding:6px 8px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; color:#666;">${img.filename}<br>${img.size}</span>
          <button data-filename="${img.filename}" style="background:#ef4444; color:white; border:none; border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer;">Delete</button>
        </div>
      `;
      card.querySelector('img').addEventListener('click', () => {
        showcaseLightboxImg.src = img.path;
        showcaseLightbox.style.display = 'flex';
      });
      card.querySelector('button').addEventListener('click', async (e) => {
        const filename = e.target.dataset.filename;
        if (!confirm(`Delete ${filename}?`)) return;
        const resp = await fetch(`/api/showcase/${filename}`, { method: 'DELETE' });
        if (resp.ok) loadShowcaseGallery();
      });
      showcaseGallery.appendChild(card);
    });
  } catch (err) {
    showcaseGallery.innerHTML = `<p style="color:red;">Failed to load gallery: ${err.message}</p>`;
  }
}

showcaseLightbox.addEventListener('click', () => { showcaseLightbox.style.display = 'none'; });

// Load galleries when tabs are shown
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'showcase') loadShowcaseGallery();
    if (tab.dataset.tab === 'wild') loadWildGallery();
    if (tab.dataset.tab === 'email') loadResendData();
    if (tab.dataset.tab === 'nip05') loadNip05Verified();
    if (tab.dataset.tab === 'deploy') { loadDeployStatus(); loadSyncStatus(); }
    if (tab.dataset.tab === 'vendors') loadVendorSubmissions();
  });
});

// --- NIP-05 Live Verification ---

async function loadNip05Verified() {
  const el = document.getElementById('nip05-verified');
  if (!el) return;
  el.innerHTML = '<p style="color:#999;">Loading verified handles...</p>';
  try {
    const resp = await fetch('/api/nip05/verify');
    const data = await resp.json();
    if (data.error) { el.innerHTML = `<p style="color:#ef4444;">${data.error}</p>`; return; }
    if (!data.verified || data.verified.length === 0) {
      el.innerHTML = '<p style="color:#999;">No verified handles found.</p>';
      return;
    }
    el.innerHTML = `<p style="font-size:13px; color:#666; margin-bottom:8px;">${data.count} verified handle${data.count !== 1 ? 's' : ''}</p>` +
      '<table style="width:100%; font-size:13px; border-collapse:collapse;">' +
      '<tr style="text-align:left; border-bottom:2px solid #e5e7eb;"><th style="padding:4px 8px;">Handle</th><th style="padding:4px 8px;">Address</th><th style="padding:4px 8px;">Profile</th><th style="padding:4px 8px;">Relays</th></tr>' +
      data.verified.map(v => {
        const npub = hexToNpub(v.hex);
        const npubShort = npub ? npub.slice(0, 16) + '...' : v.hex.slice(0, 12) + '...';
        const primalUrl = npub ? 'https://primal.net/p/' + npub : '#';
        return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:4px 8px; font-weight:500;">${v.name}</td>
          <td style="padding:4px 8px;"><span style="color:#EC008C;">${v.address}</span></td>
          <td style="padding:4px 8px;"><a href="${primalUrl}" target="_blank" rel="noopener noreferrer" style="font-family:monospace; font-size:11px; color:#6366f1; text-decoration:none;" title="${npub}">${npubShort}</a></td>
          <td style="padding:4px 8px;"><span style="font-size:11px; padding:1px 6px; border-radius:99px; background:#dcfce7; color:#16a34a;">${v.relayCount} relays</span></td>
        </tr>`;
      }).join('') +
      '</table>';
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444;">Error: ${err.message}</p>`;
  }
}

// --- Resend Email Management ---

async function loadResendData() {
  loadResendStatus();
  loadResendDomains();
  loadResendContacts();
  loadResendWebhooks();
}

async function loadResendStatus() {
  const el = document.getElementById('resend-status');
  try {
    const resp = await fetch('/api/resend/status');
    const data = await resp.json();
    if (data.authenticated) {
      el.innerHTML = `<p style="color:#16a34a; font-weight:600;">&#10003; Connected to Resend</p>`;
    } else {
      el.innerHTML = `<p style="color:#ef4444; font-weight:600;">&#10007; Not authenticated</p><p style="font-size:13px; color:#666;">Run <code>resend login</code> in your terminal to authenticate.</p>`;
    }
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444;">Error: ${err.message}</p>`;
  }
}

async function loadResendDomains() {
  const el = document.getElementById('resend-domains');
  try {
    const resp = await fetch('/api/resend/domains');
    const data = await resp.json();
    if (data.error) { el.innerHTML = `<p style="color:#ef4444; font-size:13px;">${data.error}</p>`; return; }
    const domains = Array.isArray(data) ? data : (data.data || []);
    if (domains.length === 0) { el.innerHTML = '<p style="color:#999;">No domains configured.</p>'; return; }
    el.innerHTML = domains.map(d => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #e5e7eb; font-size:13px;">
        <span style="font-weight:500;">${d.name || d.domain || 'Unknown'}</span>
        <span style="font-size:11px; padding:2px 8px; border-radius:99px; background:${d.status === 'verified' ? '#dcfce7; color:#16a34a' : '#fef3c7; color:#d97706'};">${d.status || 'unknown'}</span>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444; font-size:13px;">${err.message}</p>`;
  }
}

async function loadResendContacts() {
  const el = document.getElementById('resend-contacts');
  try {
    const resp = await fetch('/api/resend/contacts');
    const data = await resp.json();
    if (data.error) { el.innerHTML = `<p style="color:#ef4444; font-size:13px;">${data.error}</p>`; return; }
    const contacts = Array.isArray(data) ? data : (data.data || []);
    if (contacts.length === 0) { el.innerHTML = '<p style="color:#999;">No contacts yet.</p>'; return; }
    el.innerHTML = `<p style="font-size:13px; color:#666; margin-bottom:8px;">${contacts.length} contact${contacts.length !== 1 ? 's' : ''}</p>` +
      '<table style="width:100%; font-size:13px; border-collapse:collapse;">' +
      '<tr style="text-align:left; border-bottom:2px solid #e5e7eb;"><th style="padding:4px 8px;">Email</th><th style="padding:4px 8px;">Status</th><th style="padding:4px 8px;">Created</th></tr>' +
      contacts.map(c => `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:4px 8px;">${c.email || ''}</td>
          <td style="padding:4px 8px;"><span style="font-size:11px; padding:1px 6px; border-radius:99px; background:${c.unsubscribed ? '#fef2f2; color:#ef4444' : '#dcfce7; color:#16a34a'};">${c.unsubscribed ? 'unsubscribed' : 'subscribed'}</span></td>
          <td style="padding:4px 8px; color:#999;">${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</td>
        </tr>
      `).join('') +
      '</table>';
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444; font-size:13px;">${err.message}</p>`;
  }
}

async function loadResendWebhooks() {
  const el = document.getElementById('resend-webhooks');
  try {
    const resp = await fetch('/api/resend/webhooks');
    const data = await resp.json();
    if (data.error) { el.innerHTML = `<p style="color:#ef4444; font-size:13px;">${data.error}</p>`; return; }
    const webhooks = Array.isArray(data) ? data : (data.data || []);
    if (webhooks.length === 0) { el.innerHTML = '<p style="color:#999;">No webhooks configured.</p>'; return; }
    el.innerHTML = webhooks.map(w => `
      <div style="padding:6px 0; border-bottom:1px solid #e5e7eb; font-size:13px;">
        <div style="font-weight:500; word-break:break-all;">${w.endpoint_url || w.url || 'Unknown'}</div>
        <div style="color:#999; font-size:11px; margin-top:2px;">${(w.events || []).join(', ') || 'all events'}</div>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444; font-size:13px;">${err.message}</p>`;
  }
}

// Send test email
document.getElementById('send-test-email-btn').addEventListener('click', async () => {
  const to = document.getElementById('test-email-to').value.trim();
  const subject = document.getElementById('test-email-subject').value.trim();
  const resultEl = document.getElementById('test-email-result');
  if (!to) { resultEl.innerHTML = '<span style="color:#ef4444;">Enter a recipient email.</span>'; return; }
  resultEl.innerHTML = '<span style="color:#666;">Sending...</span>';
  try {
    const resp = await fetch('/api/resend/send-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject }),
    });
    const data = await resp.json();
    if (data.success) {
      resultEl.innerHTML = '<span style="color:#16a34a;">&#10003; Email sent successfully!</span>';
    } else {
      resultEl.innerHTML = `<span style="color:#ef4444;">Failed: ${data.error}</span>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<span style="color:#ef4444;">Error: ${err.message}</span>`;
  }
});

// Also reload gallery after successful upload
const origShowcaseUploadClick = showcaseUploadBtn.onclick;
const origShowcaseResultObserver = new MutationObserver(() => {
  if (showcaseResult.classList.contains('success')) loadShowcaseGallery();
});
origShowcaseResultObserver.observe(showcaseResult, { attributes: true, attributeFilter: ['class'] });

// Initial load if showcase tab is already active
if (document.getElementById('showcase')?.classList.contains('active')) loadShowcaseGallery();

// --- News Post ---
const newsTitle = document.getElementById('news-title');
const newsSlug = document.getElementById('news-slug');
const newsDate = document.getElementById('news-date');
const newsForm = document.getElementById('news-form');
const newsResult = document.getElementById('news-result');
const newsList = document.getElementById('news-list');
const newsSearch = document.getElementById('news-search');
const newsNewBtn = document.getElementById('news-new-btn');
const newsCancelBtn = document.getElementById('news-cancel-btn');
const newsFormTitle = document.getElementById('news-form-title');
const newsOriginalSlug = document.getElementById('news-original-slug');
const newsDescription = document.getElementById('news-description');
const newsTags = document.getElementById('news-tags');
const newsContent = document.getElementById('news-content');
const newsUrl = document.getElementById('news-url');
let allNewsPosts = [];

// Category buttons
const categoryBtns = document.querySelectorAll('.category-btn');
const categoryInput = document.getElementById('news-category');
const urlField = document.getElementById('news-url-field');

categoryBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const wasActive = btn.classList.contains('primary');
    categoryBtns.forEach(b => b.classList.remove('primary'));
    if (wasActive) {
      categoryInput.value = '';
      urlField.style.display = 'none';
    } else {
      btn.classList.add('primary');
      categoryInput.value = btn.dataset.category;
      urlField.style.display = btn.dataset.category === 'in-the-news' ? '' : 'none';
    }
  });
});

// Auto-set today's date
newsDate.value = new Date().toISOString().split('T')[0];

// Auto-generate slug from title
newsTitle.addEventListener('input', () => {
  newsSlug.value = newsTitle.value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
});

newsForm.addEventListener('submit', async e => {
  e.preventDefault();
  const isEdit = !!newsOriginalSlug.value;
  const formData = new FormData(newsForm);
  const submitBtn = newsForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = isEdit ? 'Updating...' : 'Publishing...';

  try {
    const resp = await fetch('/api/news/publish', { method: 'POST', body: formData });
    const data = await resp.json();

    if (data.success) {
      newsResult.className = 'result success';
      newsResult.innerHTML = `${data.updated ? 'Updated' : 'Published'}! View at <strong>${data.path}</strong> (restart dev server to see it)`;
      newsResult.hidden = false;
      resetNewsForm();
      loadNewsPosts();
    } else {
      newsResult.className = 'result error';
      newsResult.textContent = data.error;
      newsResult.hidden = false;
    }
  } catch (err) {
    newsResult.className = 'result error';
    newsResult.textContent = err.message;
    newsResult.hidden = false;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = newsOriginalSlug.value ? 'Update' : 'Publish';
});

// --- News post list + editing ---
function setNewsCategory(cat) {
  categoryBtns.forEach(b => b.classList.remove('primary'));
  categoryInput.value = cat || '';
  if (cat) {
    const btn = [...categoryBtns].find(b => b.dataset.category === cat);
    if (btn) btn.classList.add('primary');
    urlField.style.display = cat === 'in-the-news' ? '' : 'none';
  } else {
    urlField.style.display = 'none';
  }
}

function resetNewsForm() {
  newsForm.reset();
  newsOriginalSlug.value = '';
  setNewsCategory('');
  newsDate.value = new Date().toISOString().split('T')[0];
  if (newsFormTitle) newsFormTitle.textContent = 'Publish News Post';
  const submitBtn = newsForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Publish';
  if (newsCancelBtn) newsCancelBtn.style.display = 'none';
  renderNewsList();
}

async function loadNewsPosts() {
  if (!newsList) return;
  try {
    const resp = await fetch('/api/news');
    const data = await resp.json();
    allNewsPosts = data.posts || [];
    renderNewsList();
  } catch (err) {
    newsList.innerHTML = `<p class="error">Failed to load posts: ${escapeHtmlAdmin(err.message)}</p>`;
  }
}

function renderNewsList() {
  if (!newsList) return;
  const q = (newsSearch?.value || '').toLowerCase();
  const posts = allNewsPosts.filter(p =>
    !q || (p.title || '').toLowerCase().includes(q) || (p.slug || '').toLowerCase().includes(q)
  );
  if (!posts.length) {
    newsList.innerHTML = '<p class="empty">No posts found.</p>';
    return;
  }
  const activeSlug = newsOriginalSlug.value;
  newsList.innerHTML = posts.map(p => `
    <div class="news-item${p.slug === activeSlug ? ' active' : ''}" data-slug="${escapeHtmlAdmin(p.slug)}" title="Edit this post">
      <div class="news-item-title">${escapeHtmlAdmin(p.title)}</div>
      <div class="news-item-meta">${escapeHtmlAdmin(p.category || 'uncategorised')}${p.pubDate ? ' · ' + escapeHtmlAdmin(p.pubDate) : ''}</div>
    </div>`).join('');
  newsList.querySelectorAll('.news-item').forEach(el =>
    el.addEventListener('click', () => editNewsPost(el.dataset.slug))
  );
}

async function editNewsPost(slug) {
  try {
    const resp = await fetch('/api/news/' + encodeURIComponent(slug));
    const d = await resp.json();
    if (!resp.ok) {
      newsResult.className = 'result error';
      newsResult.textContent = d.error || 'Failed to load post';
      newsResult.hidden = false;
      return;
    }
    newsOriginalSlug.value = d.slug;
    newsTitle.value = d.title || '';
    newsSlug.value = d.slug || '';
    if (newsDescription) newsDescription.value = d.description || '';
    if (newsTags) newsTags.value = d.tags || '';
    newsDate.value = d.pubDate || new Date().toISOString().split('T')[0];
    setNewsCategory(d.category);
    if (newsUrl) newsUrl.value = d.url || '';
    newsContent.value = d.content || '';
    if (newsFormTitle) newsFormTitle.textContent = `Edit: ${d.title || d.slug}`;
    const submitBtn = newsForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Update';
    if (newsCancelBtn) newsCancelBtn.style.display = '';
    renderNewsList();
    newsResult.hidden = true;
    newsForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    newsResult.className = 'result error';
    newsResult.textContent = err.message;
    newsResult.hidden = false;
  }
}

newsNewBtn?.addEventListener('click', () => { resetNewsForm(); newsResult.hidden = true; });
newsCancelBtn?.addEventListener('click', () => { resetNewsForm(); newsResult.hidden = true; });
newsSearch?.addEventListener('input', renderNewsList);
document.querySelector('[data-tab="news"]')?.addEventListener('click', loadNewsPosts);
loadNewsPosts();

// --- Credits ---
const creditsList = document.getElementById('credits-list');
const creditModal = document.getElementById('credit-modal');
const creditForm = document.getElementById('credit-form');
const modalTitle = document.getElementById('modal-title');
const addCreditBtn = document.getElementById('add-credit-btn');
const cancelCreditBtn = document.getElementById('cancel-credit-btn');
const creditsSearch = document.getElementById('credits-search');
const syncCreditsBtn = document.getElementById('sync-credits-btn');
const syncResult = document.getElementById('sync-result');

let allCredits = [];

// Bech32 decoding for npub -> hex conversion
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Decode(str) {
  str = str.toLowerCase();
  const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) return null;

  const hrp = str.slice(0, pos);
  const dataStr = str.slice(pos + 1);

  const data = [];
  for (const c of dataStr) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) return null;
    data.push(idx);
  }

  // Remove checksum (last 6 characters)
  const values = data.slice(0, -6);

  // Convert 5-bit values to 8-bit bytes
  let acc = 0;
  let bits = 0;
  const bytes = [];
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }

  return { hrp, bytes };
}

function npubToHex(npub) {
  if (!npub || !npub.startsWith('npub1')) return '';
  const decoded = bech32Decode(npub);
  if (!decoded || decoded.hrp !== 'npub') return '';
  return decoded.bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Extract X username from profile URL
function extractXUsername(url) {
  if (!url) return '';
  // Match twitter.com/username or x.com/username
  const match = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
  return match ? match[1] : '';
}

async function loadCredits() {
  try {
    const resp = await fetch('/api/credits');
    allCredits = await resp.json();
    renderCredits(allCredits);
  } catch (err) {
    creditsList.innerHTML = `<p class="error">Failed to load credits: ${err.message}</p>`;
  }
}

// SVG icons for social links
const ICONS = {
  nostr: `<svg viewBox="40 38 185 180" width="16" height="16" fill="currentColor"><path d="M210.8 199.4c0 3.1-2.5 5.7-5.7 5.7h-68c-3.1 0-5.7-2.5-5.7-5.7v-15.5c.3-19 2.3-37.2 6.5-45.5 2.5-5 6.7-7.7 11.5-9.1 9.1-2.7 24.9-.9 31.7-1.2 0 0 20.4.8 20.4-10.7s-9.1-8.6-9.1-8.6c-10 .3-17.7-.4-22.6-2.4-8.3-3.3-8.6-9.2-8.6-11.2-.4-23.1-34.5-25.9-64.5-20.1-32.8 6.2.4 53.3.4 116.1v8.4c0 3.1-2.6 5.6-5.7 5.6H57.7c-3.1 0-5.7-2.5-5.7-5.7v-144c0-3.1 2.5-5.7 5.7-5.7h31.7c3.1 0 5.7 2.5 5.7 5.7 0 4.7 5.2 7.2 9 4.5 11.4-8.2 26-12.5 42.4-12.5 36.6 0 64.4 21.4 64.4 68.7v83.2ZM150 99.3c0-6.7-5.4-12.1-12.1-12.1s-12.1 5.4-12.1 12.1 5.4 12.1 12.1 12.1S150 106 150 99.3Z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>`,
  web: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
};

function renderCreditCard(c, index, sectionArr) {
  const isFirst = index === 0;
  const isLast = index === sectionArr.length - 1;
  return `
    <div class="credit-card" data-id="${c.id}">
      <div class="credit-avatar">
        ${c.logoUrl || c.nostrProfilePic || c.xProfilePic
          ? `<img src="${c.logoUrl || c.nostrProfilePic || c.xProfilePic}" alt="${c.name}" onerror="this.style.display='none'">`
          : `<span>${(c.name || '?')[0].toUpperCase()}</span>`
        }
      </div>
      <div class="credit-info">
        <div class="credit-name">
          ${(c.websiteSections || []).includes('Bitcoin Kids') ? '<span class="bitcoin-kid-star">⭐</span>' : ''}
          ${c.name || 'Unnamed'}
        </div>
        <div class="credit-role">${c.notes || c.description || ''}</div>
        <div class="credit-links">
          ${c.nostrNpub ? `<a href="https://njump.me/${c.nostrNpub}" target="_blank" title="Nostr" class="social-icon">${ICONS.nostr}</a>` : ''}
          ${c.xProfileUrl ? `<a href="${c.xProfileUrl}" target="_blank" title="X" class="social-icon">${ICONS.x}</a>` : ''}
          ${c.githubUrl ? `<a href="${c.githubUrl}" target="_blank" title="GitHub" class="social-icon">${ICONS.github}</a>` : ''}
          ${c.websiteUrl ? `<a href="${c.websiteUrl}" target="_blank" title="Website" class="social-icon">${ICONS.web}</a>` : ''}
        </div>
        <div class="credit-section-tags">
          ${(c.websiteSections && c.websiteSections.length)
            ? c.websiteSections.map(s => `<span class="credit-section-tag">${escapeHtmlAdmin(s)}</span>`).join('')
            : '<span class="credit-section-tag none">Not assigned</span>'}
        </div>
      </div>
      <div class="credit-actions">
        <button class="btn-move move-credit-up" data-id="${c.id}" title="Move up" ${isFirst ? 'disabled' : ''}>&#9650;</button>
        <button class="btn-move move-credit-down" data-id="${c.id}" title="Move down" ${isLast ? 'disabled' : ''}>&#9660;</button>
        <button class="btn-icon edit-credit" title="Edit">✏️</button>
        <button class="btn-icon delete-credit" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function renderCredits(credits) {
  if (credits.length === 0) {
    creditsList.innerHTML = '<p class="empty">No credits yet. Click "Add Credit" to create one.</p>';
    return;
  }

  // One flat list of all credits (people and organisations). Each card shows
  // its assigned website sections as badges; a credit can be in several.
  creditsList.innerHTML = `<div class="credits-section-list">${credits.map((c, i, arr) => renderCreditCard(c, i, arr)).join('')}</div>`;

  // Attach event listeners
  creditsList.querySelectorAll('.edit-credit').forEach(btn => {
    btn.addEventListener('click', () => editCredit(btn.closest('.credit-card').dataset.id));
  });
  creditsList.querySelectorAll('.delete-credit').forEach(btn => {
    btn.addEventListener('click', () => deleteCredit(btn.closest('.credit-card').dataset.id));
  });
  creditsList.querySelectorAll('.move-credit-up').forEach(btn => {
    btn.addEventListener('click', () => moveCredit(btn.dataset.id, 'up'));
  });
  creditsList.querySelectorAll('.move-credit-down').forEach(btn => {
    btn.addEventListener('click', () => moveCredit(btn.dataset.id, 'down'));
  });
}

function openModal(credit = null) {
  modalTitle.textContent = credit ? 'Edit Credit' : 'Add Credit';
  document.getElementById('credit-id').value = credit?.id || '';
  document.getElementById('credit-name').value = credit?.name || '';
  document.getElementById('credit-nostr-npub').value = credit?.nostrNpub || '';
  // Auto-calculate hex from npub when opening modal
  const npubValue = credit?.nostrNpub || '';
  const hex = npubValue ? npubToHex(npubValue) : '';
  document.getElementById('credit-nostr-hex').value = hex;
  // Use stored pic or fetch from Primal
  if (credit?.nostrProfilePic) {
    document.getElementById('credit-nostr-pic').value = credit.nostrProfilePic;
  } else if (hex) {
    document.getElementById('credit-nostr-pic').value = 'Loading...';
    fetch(`/api/nostr/profile/${hex}`)
      .then(r => r.json())
      .then(p => { document.getElementById('credit-nostr-pic').value = p.picture || ''; })
      .catch(() => { document.getElementById('credit-nostr-pic').value = ''; });
  } else {
    document.getElementById('credit-nostr-pic').value = '';
  }
  document.getElementById('credit-x-url').value = credit?.xProfileUrl || '';
  // Use stored pic or auto-generate from X URL
  if (credit?.xProfilePic) {
    document.getElementById('credit-x-pic').value = credit.xProfilePic;
  } else if (credit?.xProfileUrl) {
    const username = extractXUsername(credit.xProfileUrl);
    document.getElementById('credit-x-pic').value = username ? `https://unavatar.io/twitter/${username}` : '';
  } else {
    document.getElementById('credit-x-pic').value = '';
  }
  document.getElementById('credit-website-url').value = credit?.websiteUrl || '';
  document.getElementById('credit-github-url').value = credit?.githubUrl || '';
  document.getElementById('credit-description').value = credit?.description || '';
  document.getElementById('credit-notes').value = credit?.notes || '';
  document.getElementById('credit-show-on-website').checked = credit?.showOnWebsite || false;
  // Logo
  pendingCreditLogoFile = null;
  setCreditLogo(credit?.logoUrl || '');
  // Website sections (multi-select)
  const sections = credit?.websiteSections || [];
  document.querySelectorAll('#credit-sections input[type=checkbox]').forEach(cb => {
    cb.checked = sections.includes(cb.value);
  });
  creditModal.hidden = false;
}

function closeModal() {
  creditModal.hidden = true;
  creditForm.reset();
}

function editCredit(id) {
  const credit = allCredits.find(c => c.id === id);
  if (credit) openModal(credit);
}

async function deleteCredit(id) {
  const credit = allCredits.find(c => c.id === id);
  if (!confirm(`Delete credit "${credit?.name || 'Unnamed'}"?`)) return;

  try {
    await fetch(`/api/credits/${id}`, { method: 'DELETE' });
    loadCredits();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

async function moveCredit(id, direction) {
  // Flat list: swap with the adjacent credit in the full list.
  const idx = allCredits.findIndex(c => c.id === id);
  if (idx === -1) return;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= allCredits.length) return;

  const reordered = [...allCredits];
  [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
  const ids = reordered.map(c => c.id);
  try {
    const resp = await fetch('/api/credits/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const result = await resp.json();
    if (result.success) {
      allCredits = reordered;
      renderCredits(allCredits);
    }
  } catch (err) {
    alert('Failed to reorder: ' + err.message);
  }
}

addCreditBtn.addEventListener('click', () => openModal());
cancelCreditBtn.addEventListener('click', closeModal);
creditModal.addEventListener('click', e => {
  if (e.target === creditModal) closeModal();
});

creditForm.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('credit-id').value;

  // Upload a pending logo file first, if one was chosen.
  let logoUrl = creditLogoUrl.value;
  if (pendingCreditLogoFile) {
    try {
      const fd = new FormData();
      fd.append('logo', pendingCreditLogoFile);
      fd.append('name', document.getElementById('credit-name').value || 'credit');
      const r = await fetch('/api/credits/logo', { method: 'POST', body: fd });
      const j = await r.json();
      if (j.success) logoUrl = j.path;
    } catch (err) { /* keep URL field value on upload failure */ }
  }

  const websiteSections = [...document.querySelectorAll('#credit-sections input[type=checkbox]:checked')].map(cb => cb.value);

  const data = {
    name: document.getElementById('credit-name').value,
    nostrNpub: document.getElementById('credit-nostr-npub').value,
    nostrHex: document.getElementById('credit-nostr-hex').value,
    nostrProfilePic: document.getElementById('credit-nostr-pic').value,
    xProfileUrl: document.getElementById('credit-x-url').value,
    xProfilePic: document.getElementById('credit-x-pic').value,
    websiteUrl: document.getElementById('credit-website-url').value,
    githubUrl: document.getElementById('credit-github-url').value,
    description: document.getElementById('credit-description').value,
    logoUrl,
    notes: document.getElementById('credit-notes').value,
    showOnWebsite: document.getElementById('credit-show-on-website').checked,
    websiteSections,
  };

  try {
    if (id) {
      await fetch(`/api/credits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    closeModal();
    loadCredits();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

// Credit logo upload (used for landing-page sections)
let pendingCreditLogoFile = null;
const creditLogoFile = document.getElementById('credit-logo-file');
const creditLogoUploadBtn = document.getElementById('credit-logo-upload-btn');
const creditLogoUrl = document.getElementById('credit-logo-url');
const creditLogoPreview = document.getElementById('credit-logo-preview');
const creditLogoPreviewImg = document.getElementById('credit-logo-preview-img');
const creditLogoClear = document.getElementById('credit-logo-clear');

function setCreditLogo(url) {
  creditLogoUrl.value = url || '';
  if (url) {
    creditLogoPreviewImg.src = url;
    creditLogoPreview.hidden = false;
  } else {
    creditLogoPreviewImg.removeAttribute('src');
    creditLogoPreview.hidden = true;
  }
}
creditLogoUploadBtn?.addEventListener('click', () => creditLogoFile.click());
creditLogoFile?.addEventListener('change', () => {
  if (creditLogoFile.files[0]) {
    pendingCreditLogoFile = creditLogoFile.files[0];
    setCreditLogo(URL.createObjectURL(pendingCreditLogoFile));
  }
});
creditLogoUrl?.addEventListener('input', () => { pendingCreditLogoFile = null; setCreditLogo(creditLogoUrl.value); });
creditLogoClear?.addEventListener('click', () => { pendingCreditLogoFile = null; setCreditLogo(''); });

creditsSearch.addEventListener('input', () => {
  const query = creditsSearch.value.toLowerCase();
  const filtered = allCredits.filter(c =>
    (c.name || '').toLowerCase().includes(query) ||
    (c.email || '').toLowerCase().includes(query) ||
    (c.role || '').toLowerCase().includes(query) ||
    (c.notes || '').toLowerCase().includes(query) ||
    (c.description || '').toLowerCase().includes(query) ||
    (c.websiteSections || []).some(s => s.toLowerCase().includes(query))
  );
  renderCredits(filtered);
});

// Sync credits to website
syncCreditsBtn.addEventListener('click', async () => {
  syncCreditsBtn.disabled = true;
  syncCreditsBtn.textContent = 'Syncing...';

  // The server exports every on-website credit by its section (credits-page
  // sections and landing-page sections alike), so no section filter is sent.
  try {
    const resp = await fetch('/api/credits/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await resp.json();

    if (data.success) {
      syncResult.className = 'result success';
      syncResult.innerHTML = `Synced to <strong>${data.path}</strong>: ${data.exported.coreTeam} Core Team, ${data.exported.contributors} Contributors`;
    } else {
      syncResult.className = 'result error';
      syncResult.textContent = data.error;
    }
  } catch (err) {
    syncResult.className = 'result error';
    syncResult.textContent = err.message;
  }

  syncResult.hidden = false;
  syncCreditsBtn.disabled = false;
  syncCreditsBtn.textContent = 'Sync to Website';
});

// Load credits when the tab is clicked.
document.querySelector('[data-tab="credits"]').addEventListener('click', loadCredits);

// Auto-calculate nostr hex and fetch profile picture from Primal
document.getElementById('credit-nostr-npub').addEventListener('input', async e => {
  const npub = e.target.value.trim();
  const hexField = document.getElementById('credit-nostr-hex');
  const picField = document.getElementById('credit-nostr-pic');
  const hex = npubToHex(npub);
  hexField.value = hex;

  // Fetch profile picture from Primal via our API
  if (hex) {
    picField.value = 'Loading...';
    try {
      const resp = await fetch(`/api/nostr/profile/${hex}`);
      const profile = await resp.json();
      picField.value = profile.picture || '';
    } catch (err) {
      picField.value = '';
    }
  } else {
    picField.value = '';
  }
});

// Copy hex to clipboard
document.getElementById('copy-hex-btn').addEventListener('click', async () => {
  const hexField = document.getElementById('credit-nostr-hex');
  const copyBtn = document.getElementById('copy-hex-btn');
  if (!hexField.value) return;

  try {
    await navigator.clipboard.writeText(hexField.value);
    copyBtn.textContent = '✓';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = '📋';
      copyBtn.classList.remove('copied');
    }, 1500);
  } catch (err) {
    hexField.select();
    document.execCommand('copy');
  }
});

// Auto-populate X profile picture from X profile URL
document.getElementById('credit-x-url').addEventListener('input', e => {
  const url = e.target.value.trim();
  const picField = document.getElementById('credit-x-pic');
  const username = extractXUsername(url);

  if (username) {
    picField.value = `https://unavatar.io/twitter/${username}`;
  } else {
    picField.value = '';
  }
});

// Copy X profile pic URL to clipboard
document.getElementById('copy-x-pic-btn').addEventListener('click', async () => {
  const picField = document.getElementById('credit-x-pic');
  const copyBtn = document.getElementById('copy-x-pic-btn');
  if (!picField.value) return;

  try {
    await navigator.clipboard.writeText(picField.value);
    copyBtn.textContent = '✓';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = '📋';
      copyBtn.classList.remove('copied');
    }, 1500);
  } catch (err) {
    picField.select();
    document.execCommand('copy');
  }
});

// --- NIP-05 Management ---

const nip05List = document.getElementById('nip05-list');
const nip05Modal = document.getElementById('nip05-modal');
const nip05Form = document.getElementById('nip05-form');
const nip05ModalTitle = document.getElementById('nip05-modal-title');
const addNip05Btn = document.getElementById('add-nip05-btn');
const cancelNip05Btn = document.getElementById('cancel-nip05-btn');
const nip05Search = document.getElementById('nip05-search');

let allNip05Entries = [];
let nip05ProfileCache = {};

async function loadNip05() {
  try {
    const resp = await fetch('/api/nip05');
    allNip05Entries = await resp.json();
    // Fetch profile pics for all entries
    await Promise.all(allNip05Entries.map(async (entry) => {
      if (!nip05ProfileCache[entry.hex]) {
        try {
          const profileResp = await fetch(`/api/nostr/profile/${entry.hex}`);
          const profile = await profileResp.json();
          nip05ProfileCache[entry.hex] = profile;
        } catch {
          nip05ProfileCache[entry.hex] = { picture: '', name: '' };
        }
      }
    }));
    renderNip05(allNip05Entries);
  } catch (err) {
    nip05List.innerHTML = `<p class="error">Failed to load NIP-05 entries: ${err.message}</p>`;
  }
}

function hexToNpub(hex) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

  function polymod(values) {
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) {
        if ((top >> i) & 1) chk ^= GEN[i];
      }
    }
    return chk;
  }

  function hrpExpand(hrp) {
    const ret = [];
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
    return ret;
  }

  // Convert hex to bytes
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }

  // Convert 8-bit bytes to 5-bit groups
  let bits = 0, value = 0;
  const data = [];
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((value >> bits) & 31);
    }
  }
  if (bits > 0) data.push((value << (5 - bits)) & 31);

  // Create checksum
  const expanded = hrpExpand('npub');
  const chkInput = [...expanded, ...data, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(chkInput) ^ 1;
  const checksumData = [];
  for (let i = 0; i < 6; i++) {
    checksumData.push((checksum >> (5 * (5 - i))) & 31);
  }

  return 'npub1' + [...data, ...checksumData].map(d => CHARSET[d]).join('');
}

function renderNip05Card(entry) {
  const profile = nip05ProfileCache[entry.hex] || {};
  const npub = hexToNpub(entry.hex);

  return `
    <div class="credit-card" data-name="${entry.name}">
      <div class="credit-avatar">
        ${profile.picture
          ? `<img src="${profile.picture}" alt="${entry.name}" onerror="this.style.display='none'">`
          : `<span>${entry.name[0].toUpperCase()}</span>`
        }
      </div>
      <div class="credit-info">
        <div class="credit-name">${profile.name || entry.name}</div>
        <div class="credit-role">${entry.name}@lightningpiggy.com</div>
        <div class="credit-details">
          <span title="Hex">${entry.hex.substring(0, 8)}...${entry.hex.substring(56)}</span>
        </div>
        <div class="credit-links">
          <a href="https://njump.me/${npub}" target="_blank" title="View on Nostr" class="social-icon">${ICONS.nostr}</a>
        </div>
      </div>
      <div class="credit-actions">
        <button class="btn-icon edit-nip05" title="Edit">✏️</button>
        <button class="btn-icon delete-nip05" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function renderNip05(entries) {
  if (entries.length === 0) {
    nip05List.innerHTML = '<p class="empty">No NIP-05 entries yet. Click "Add Entry" to create one.</p>';
    return;
  }

  nip05List.innerHTML = `
    <div class="credits-section">
      <h3 class="credits-section-title">Verified Addresses <span class="credits-section-count">(${entries.length})</span></h3>
      <div class="credits-section-list">${entries.map(renderNip05Card).join('')}</div>
    </div>
  `;

  // Attach event listeners
  nip05List.querySelectorAll('.edit-nip05').forEach(btn => {
    btn.addEventListener('click', () => editNip05(btn.closest('.credit-card').dataset.name));
  });
  nip05List.querySelectorAll('.delete-nip05').forEach(btn => {
    btn.addEventListener('click', () => deleteNip05(btn.closest('.credit-card').dataset.name));
  });
}

function openNip05Modal(entry = null) {
  nip05ModalTitle.textContent = entry ? 'Edit NIP-05 Entry' : 'Add NIP-05 Entry';
  document.getElementById('nip05-original-name').value = entry?.name || '';
  document.getElementById('nip05-name').value = entry?.name || '';

  if (entry) {
    const npub = hexToNpub(entry.hex);
    document.getElementById('nip05-npub').value = npub;
    document.getElementById('nip05-hex').value = entry.hex;
    document.getElementById('nip05-relays').value = (entry.relays || []).join('\n');
    const profile = nip05ProfileCache[entry.hex] || {};
    document.getElementById('nip05-pic').value = profile.picture || '';
  } else {
    document.getElementById('nip05-npub').value = '';
    document.getElementById('nip05-hex').value = '';
    document.getElementById('nip05-relays').value = 'wss://relay.primal.net\nwss://relay.damus.io\nwss://relay.nostr.band\nwss://nos.lol\nwss://relay.snort.social';
    document.getElementById('nip05-pic').value = '';
  }

  nip05Modal.hidden = false;
}

function closeNip05Modal() {
  nip05Modal.hidden = true;
  nip05Form.reset();
}

function editNip05(name) {
  const entry = allNip05Entries.find(e => e.name === name);
  if (entry) openNip05Modal(entry);
}

async function deleteNip05(name) {
  if (!confirm(`Delete NIP-05 entry "${name}@lightningpiggy.com"?`)) return;

  try {
    await fetch(`/api/nip05/${name}`, { method: 'DELETE' });
    loadNip05();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

addNip05Btn.addEventListener('click', () => openNip05Modal());
cancelNip05Btn.addEventListener('click', closeNip05Modal);
nip05Modal.addEventListener('click', e => {
  if (e.target === nip05Modal) closeNip05Modal();
});

nip05Form.addEventListener('submit', async e => {
  e.preventDefault();
  const originalName = document.getElementById('nip05-original-name').value;
  const name = document.getElementById('nip05-name').value.toLowerCase().trim();
  const hex = document.getElementById('nip05-hex').value;
  const relaysText = document.getElementById('nip05-relays').value;
  const relays = relaysText.split('\n').map(r => r.trim()).filter(Boolean);

  if (!hex) {
    alert('Please enter a valid npub');
    return;
  }

  try {
    if (originalName) {
      // Update existing
      await fetch(`/api/nip05/${originalName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, hex, relays }),
      });
    } else {
      // Create new
      await fetch('/api/nip05', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, hex, relays }),
      });
    }
    closeNip05Modal();
    loadNip05();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

nip05Search.addEventListener('input', () => {
  const query = nip05Search.value.toLowerCase();
  const filtered = allNip05Entries.filter(e =>
    e.name.toLowerCase().includes(query) ||
    e.hex.toLowerCase().includes(query)
  );
  renderNip05(filtered);
});

// Auto-calculate hex and fetch profile pic from npub for NIP-05
document.getElementById('nip05-npub').addEventListener('input', async e => {
  const npub = e.target.value.trim();
  const hexField = document.getElementById('nip05-hex');
  const picField = document.getElementById('nip05-pic');
  const hex = npubToHex(npub);
  hexField.value = hex;

  if (hex) {
    picField.value = 'Loading...';
    try {
      const resp = await fetch(`/api/nostr/profile/${hex}`);
      const profile = await resp.json();
      picField.value = profile.picture || '';
      nip05ProfileCache[hex] = profile;
    } catch (err) {
      picField.value = '';
    }
  } else {
    picField.value = '';
  }
});

// Copy hex to clipboard for NIP-05
document.getElementById('copy-nip05-hex-btn').addEventListener('click', async () => {
  const hexField = document.getElementById('nip05-hex');
  const copyBtn = document.getElementById('copy-nip05-hex-btn');
  if (!hexField.value) return;

  try {
    await navigator.clipboard.writeText(hexField.value);
    copyBtn.textContent = '✓';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = '📋';
      copyBtn.classList.remove('copied');
    }, 1500);
  } catch (err) {
    hexField.select();
    document.execCommand('copy');
  }
});

// Load NIP-05 entries when tab is clicked
document.querySelector('[data-tab="nip05"]').addEventListener('click', loadNip05);

// --- Testimonials ---
const testimonialsList = document.getElementById('testimonials-list');
const testimonialModal = document.getElementById('testimonial-modal');
const testimonialForm = document.getElementById('testimonial-form');
const testimonialModalTitle = document.getElementById('testimonial-modal-title');
const addTestimonialBtn = document.getElementById('add-testimonial-btn');
const cancelTestimonialBtn = document.getElementById('cancel-testimonial-btn');
const testimonialsSearch = document.getElementById('testimonials-search');
const syncTestimonialsBtn = document.getElementById('sync-testimonials-btn');
const testimonialsSyncResult = document.getElementById('testimonials-sync-result');

let allTestimonials = [];

// Platform icons for testimonials
const PLATFORM_ICONS = {
  nostr: ICONS.nostr,
  x: ICONS.x,
  telegram: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  other: ICONS.web
};

async function loadTestimonials() {
  try {
    const resp = await fetch('/api/testimonials');
    allTestimonials = await resp.json();
    renderTestimonials(allTestimonials);
  } catch (err) {
    testimonialsList.innerHTML = `<p class="error">Failed to load testimonials: ${err.message}</p>`;
  }
}

function renderTestimonialCard(t, index, sectionArr) {
  const platformIcon = PLATFORM_ICONS[t.sourcePlatform] || PLATFORM_ICONS.other;
  const truncatedQuote = t.quote.length > 100 ? t.quote.substring(0, 100) + '...' : t.quote;
  const isFirst = index === 0;
  const isLast = index === sectionArr.length - 1;

  return `
    <div class="credit-card" data-id="${t.id}">
      <div class="credit-avatar">
        ${t.profilePic
          ? `<img src="${t.profilePic}" alt="${t.name}" onerror="this.style.display='none'">`
          : `<span>${(t.name || '?')[0].toUpperCase()}</span>`
        }
      </div>
      <div class="credit-info">
        <div class="credit-name">${t.name || 'Anonymous'}</div>
        <div class="credit-role testimonial-quote">"${truncatedQuote}"</div>
        <div class="credit-links">
          <a href="${t.sourceUrl}" target="_blank" title="View on ${t.sourcePlatform}" class="social-icon">${platformIcon}</a>
          ${!t.showOnWebsite ? '<span class="status-badge hidden">Hidden</span>' : ''}
        </div>
      </div>
      <div class="credit-actions">
        <button class="btn-move move-testimonial-up" title="Move up" ${isFirst ? 'disabled' : ''}>▲</button>
        <button class="btn-move move-testimonial-down" title="Move down" ${isLast ? 'disabled' : ''}>▼</button>
        <button class="btn-icon edit-testimonial" title="Edit">✏️</button>
        <button class="btn-icon delete-testimonial" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function renderTestimonials(testimonials) {
  if (testimonials.length === 0) {
    testimonialsList.innerHTML = '<p class="empty">No testimonials yet. Click "Add Testimonial" to create one.</p>';
    return;
  }

  const visible = testimonials.filter(t => t.showOnWebsite);
  const hidden = testimonials.filter(t => !t.showOnWebsite);

  let html = '';

  if (visible.length > 0) {
    html += `
      <div class="credits-section">
        <h3 class="credits-section-title">Visible on Website <span class="credits-section-count">(${visible.length})</span></h3>
        <div class="credits-section-list">${visible.map((t, i, arr) => renderTestimonialCard(t, i, arr)).join('')}</div>
      </div>
    `;
  }

  if (hidden.length > 0) {
    html += `
      <div class="credits-section">
        <h3 class="credits-section-title">Hidden <span class="credits-section-count">(${hidden.length})</span></h3>
        <div class="credits-section-list">${hidden.map((t, i, arr) => renderTestimonialCard(t, i, arr)).join('')}</div>
      </div>
    `;
  }

  testimonialsList.innerHTML = html;

  // Attach event listeners
  testimonialsList.querySelectorAll('.edit-testimonial').forEach(btn => {
    btn.addEventListener('click', () => editTestimonial(btn.closest('.credit-card').dataset.id));
  });
  testimonialsList.querySelectorAll('.delete-testimonial').forEach(btn => {
    btn.addEventListener('click', () => deleteTestimonial(btn.closest('.credit-card').dataset.id));
  });
  testimonialsList.querySelectorAll('.move-testimonial-up').forEach(btn => {
    btn.addEventListener('click', () => moveTestimonial(btn.closest('.credit-card').dataset.id, 'up'));
  });
  testimonialsList.querySelectorAll('.move-testimonial-down').forEach(btn => {
    btn.addEventListener('click', () => moveTestimonial(btn.closest('.credit-card').dataset.id, 'down'));
  });
}

function openTestimonialModal(testimonial = null) {
  testimonialModalTitle.textContent = testimonial ? 'Edit Testimonial' : 'Add Testimonial';
  document.getElementById('testimonial-id').value = testimonial?.id || '';
  document.getElementById('testimonial-name').value = testimonial?.name || '';
  document.getElementById('testimonial-nostr-npub').value = testimonial?.nostrNpub || '';
  document.getElementById('testimonial-profile-pic').value = testimonial?.profilePic || '';
  document.getElementById('testimonial-quote').value = testimonial?.quote || '';
  document.getElementById('testimonial-source-platform').value = testimonial?.sourcePlatform || '';
  document.getElementById('testimonial-source-url').value = testimonial?.sourceUrl || '';
  document.getElementById('testimonial-show-on-website').checked = testimonial?.showOnWebsite !== false;

  // Reset profile pic source to URL mode
  document.querySelector('input[name="profile-pic-source"][value="url"]').checked = true;
  document.getElementById('testimonial-profile-pic').style.display = 'block';
  document.getElementById('testimonial-profile-upload').style.display = 'none';
  document.getElementById('testimonial-profile-upload').value = '';

  // Show preview if there's a profile pic URL
  const preview = document.getElementById('testimonial-pic-preview');
  if (testimonial?.profilePic) {
    preview.src = testimonial.profilePic;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }

  testimonialModal.hidden = false;
}

function closeTestimonialModal() {
  testimonialModal.hidden = true;
  testimonialForm.reset();
}

function editTestimonial(id) {
  const testimonial = allTestimonials.find(t => t.id === id);
  if (testimonial) openTestimonialModal(testimonial);
}

async function deleteTestimonial(id) {
  const testimonial = allTestimonials.find(t => t.id === id);
  if (!confirm(`Delete testimonial from "${testimonial?.name || 'Anonymous'}"?`)) return;

  try {
    await fetch(`/api/testimonials/${id}`, { method: 'DELETE' });
    loadTestimonials();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

async function moveTestimonial(id, direction) {
  const testimonial = allTestimonials.find(t => t.id === id);
  if (!testimonial) return;

  // Group by showOnWebsite (visible vs hidden)
  const section = testimonial.showOnWebsite ? 'visible' : 'hidden';
  const sectionTestimonials = allTestimonials.filter(t =>
    section === 'visible' ? t.showOnWebsite : !t.showOnWebsite
  );

  const indexInSection = sectionTestimonials.findIndex(t => t.id === id);
  if (direction === 'up' && indexInSection <= 0) return;
  if (direction === 'down' && indexInSection >= sectionTestimonials.length - 1) return;

  const swapIndex = direction === 'up' ? indexInSection - 1 : indexInSection + 1;
  [sectionTestimonials[indexInSection], sectionTestimonials[swapIndex]] =
    [sectionTestimonials[swapIndex], sectionTestimonials[indexInSection]];

  // Rebuild full array: visible first, then hidden
  const reordered = [];
  if (section === 'visible') {
    reordered.push(...sectionTestimonials);
    reordered.push(...allTestimonials.filter(t => !t.showOnWebsite));
  } else {
    reordered.push(...allTestimonials.filter(t => t.showOnWebsite));
    reordered.push(...sectionTestimonials);
  }

  const ids = reordered.map(t => t.id);

  try {
    const resp = await fetch('/api/testimonials/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const result = await resp.json();
    if (result.success) {
      allTestimonials = reordered;
      const query = testimonialsSearch.value.toLowerCase();
      if (query) {
        const filtered = allTestimonials.filter(t =>
          (t.name || '').toLowerCase().includes(query) ||
          (t.quote || '').toLowerCase().includes(query)
        );
        renderTestimonials(filtered);
      } else {
        renderTestimonials(allTestimonials);
      }
    }
  } catch (err) {
    alert('Failed to reorder: ' + err.message);
  }
}

addTestimonialBtn.addEventListener('click', () => openTestimonialModal());
cancelTestimonialBtn.addEventListener('click', closeTestimonialModal);
testimonialModal.addEventListener('click', e => {
  if (e.target === testimonialModal) closeTestimonialModal();
});

testimonialForm.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('testimonial-id').value;
  const isUpload = document.querySelector('input[name="profile-pic-source"]:checked')?.value === 'upload';
  const uploadFile = document.getElementById('testimonial-profile-upload').files[0];

  let profilePicUrl = document.getElementById('testimonial-profile-pic').value;

  // If uploading a file, upload it first to get the URL
  if (isUpload && uploadFile) {
    try {
      const formData = new FormData();
      formData.append('profilePic', uploadFile);
      if (id) formData.append('testimonialId', id);

      const uploadResp = await fetch('/api/testimonials/upload-profile', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadResp.json();

      if (!uploadResp.ok || !uploadData.success) {
        throw new Error(uploadData.error || 'Upload failed');
      }
      profilePicUrl = uploadData.profilePic;
    } catch (err) {
      alert('Failed to upload profile picture: ' + err.message);
      return;
    }
  }

  const data = {
    name: document.getElementById('testimonial-name').value,
    nostrNpub: document.getElementById('testimonial-nostr-npub').value,
    profilePic: profilePicUrl,
    quote: document.getElementById('testimonial-quote').value,
    sourcePlatform: document.getElementById('testimonial-source-platform').value,
    sourceUrl: document.getElementById('testimonial-source-url').value,
    showOnWebsite: document.getElementById('testimonial-show-on-website').checked,
  };

  try {
    if (id) {
      await fetch(`/api/testimonials/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch('/api/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    closeTestimonialModal();
    loadTestimonials();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

testimonialsSearch.addEventListener('input', () => {
  const query = testimonialsSearch.value.toLowerCase();
  const filtered = allTestimonials.filter(t =>
    (t.name || '').toLowerCase().includes(query) ||
    (t.quote || '').toLowerCase().includes(query)
  );
  renderTestimonials(filtered);
});

// Sync testimonials to website
syncTestimonialsBtn.addEventListener('click', async () => {
  syncTestimonialsBtn.disabled = true;
  syncTestimonialsBtn.textContent = 'Syncing...';

  try {
    const resp = await fetch('/api/testimonials/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await resp.json();

    if (data.success) {
      testimonialsSyncResult.className = 'result success';
      testimonialsSyncResult.innerHTML = `Synced to <strong>${data.path}</strong>: ${data.exported} testimonials`;
    } else {
      testimonialsSyncResult.className = 'result error';
      testimonialsSyncResult.textContent = data.error;
    }
  } catch (err) {
    testimonialsSyncResult.className = 'result error';
    testimonialsSyncResult.textContent = err.message;
  }

  testimonialsSyncResult.hidden = false;
  syncTestimonialsBtn.disabled = false;
  syncTestimonialsBtn.textContent = 'Sync to Website';
});

// Load testimonials when tab is clicked
document.querySelector('[data-tab="testimonials"]').addEventListener('click', loadTestimonials);

// Auto-fetch Nostr profile pic and name for testimonials
document.getElementById('testimonial-nostr-npub').addEventListener('input', async e => {
  const npub = e.target.value.trim();
  const picField = document.getElementById('testimonial-profile-pic');
  const nameField = document.getElementById('testimonial-name');
  const hex = npubToHex(npub);

  if (hex) {
    picField.value = 'Loading...';
    try {
      const resp = await fetch(`/api/nostr/profile/${hex}`);
      const profile = await resp.json();
      picField.value = profile.picture || '';
      // Auto-fill name if empty
      if (!nameField.value && profile.name) {
        nameField.value = profile.name;
      }
    } catch (err) {
      picField.value = '';
    }
  }
});

// Auto-detect platform and fetch profile pic from source URL
document.getElementById('testimonial-source-url').addEventListener('input', e => {
  const url = e.target.value.trim();
  const platformField = document.getElementById('testimonial-source-platform');
  const picField = document.getElementById('testimonial-profile-pic');

  // Auto-detect platform from URL
  if (url.match(/(?:twitter\.com|x\.com)\//i)) {
    platformField.value = 'x';
    // Extract username and set profile pic if not already set
    const username = extractXUsername(url);
    if (username && !picField.value) {
      picField.value = `https://unavatar.io/twitter/${username}`;
    }
  } else if (url.match(/(?:primal\.net|njump\.me|snort\.social|nostr\.band)/i)) {
    platformField.value = 'nostr';
  } else if (url.match(/(?:t\.me|telegram\.)/i)) {
    platformField.value = 'telegram';
  } else if (url.match(/(?:youtube\.com|youtu\.be)/i)) {
    platformField.value = 'youtube';
  }
});

// Profile picture source toggle (URL vs Upload)
const profilePicUrlInput = document.getElementById('testimonial-profile-pic');
const profilePicUploadInput = document.getElementById('testimonial-profile-upload');
const profilePicPreview = document.getElementById('testimonial-pic-preview');

document.querySelectorAll('input[name="profile-pic-source"]').forEach(radio => {
  radio.addEventListener('change', e => {
    const isUpload = e.target.value === 'upload';
    profilePicUrlInput.style.display = isUpload ? 'none' : 'block';
    profilePicUploadInput.style.display = isUpload ? 'block' : 'none';
    // Clear the non-selected input
    if (isUpload) {
      profilePicUrlInput.value = '';
    } else {
      profilePicUploadInput.value = '';
      profilePicPreview.style.display = 'none';
    }
  });
});

// Handle file selection - show preview
profilePicUploadInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      profilePicPreview.src = ev.target.result;
      profilePicPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    profilePicPreview.style.display = 'none';
  }
});

// Also show preview for URL input
profilePicUrlInput.addEventListener('input', e => {
  const url = e.target.value.trim();
  if (url && url.startsWith('http')) {
    profilePicPreview.src = url;
    profilePicPreview.style.display = 'block';
  } else {
    profilePicPreview.style.display = 'none';
  }
});

// --- Vendors / Market ---

const vendorsList = document.getElementById('vendors-list');
const vendorModal = document.getElementById('vendor-modal');
const vendorForm = document.getElementById('vendor-form');
const vendorModalTitle = document.getElementById('vendor-modal-title');
const addVendorBtn = document.getElementById('add-vendor-btn');
const cancelVendorBtn = document.getElementById('cancel-vendor-btn');
const vendorsSearch = document.getElementById('vendors-search');
const syncVendorsBtn = document.getElementById('sync-vendors-btn');
const vendorsSyncResult = document.getElementById('vendors-sync-result');

let allVendors = [];
let pendingVendorLogoFile = null;

const SHOP_TYPE_LABELS = {
  online: '🌐 Online',
  physical: '🏪 Physical',
  both: '🌐🏪 Online & Physical',
};

// --- Pending vendor applications (from the public market-page form) ---

const submissionsList = document.getElementById('submissions-list');
const submissionsResult = document.getElementById('submissions-result');
const pendingCountBadge = document.getElementById('pending-count');
const refreshSubmissionsBtn = document.getElementById('refresh-submissions-btn');

let pendingSubmissions = [];

function escapeHtmlAdmin(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setPendingBadge(n) {
  if (!pendingCountBadge) return;
  pendingCountBadge.textContent = String(n);
  pendingCountBadge.hidden = n === 0;
}

function showSubmissionsResult(message, type) {
  if (!submissionsResult) return;
  submissionsResult.textContent = message;
  submissionsResult.className = 'result' + (type ? ' ' + type : '');
  submissionsResult.hidden = false;
}

async function loadVendorSubmissions() {
  if (!submissionsList) return;
  submissionsList.innerHTML = '<p class="empty">Checking…</p>';
  try {
    const resp = await fetch('/api/vendors/submissions');
    const data = await resp.json();
    if (!resp.ok) {
      pendingSubmissions = [];
      setPendingBadge(0);
      submissionsList.innerHTML = '';
      // A missing token is a configuration note, not a scary error.
      showSubmissionsResult(data.error || 'Could not load applications.', data.configured === false ? '' : 'error');
      return;
    }
    submissionsResult && (submissionsResult.hidden = true);
    pendingSubmissions = data.submissions || [];
    setPendingBadge(pendingSubmissions.length);
    renderVendorSubmissions();
  } catch (err) {
    submissionsList.innerHTML = `<p class="error">Failed to load applications: ${escapeHtmlAdmin(err.message)}</p>`;
  }
}

function renderVendorSubmissions() {
  if (!submissionsList) return;
  if (pendingSubmissions.length === 0) {
    submissionsList.innerHTML = '<p class="empty">No pending applications.</p>';
    return;
  }
  submissionsList.innerHTML = pendingSubmissions.map(s => {
    const regions = (s.shippingRegions || []).map(escapeHtmlAdmin).join(', ') || '—';
    const website = s.websiteUrl ? `<a href="${escapeHtmlAdmin(s.websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtmlAdmin(s.websiteUrl)}</a>` : '—';
    const nostr = s.nostrNpub ? escapeHtmlAdmin(s.nostrNpub) : '—';
    const x = s.xProfileUrl ? `<a href="${escapeHtmlAdmin(s.xProfileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtmlAdmin(s.xProfileUrl)}</a>` : '—';
    const when = s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '';
    // Public store description (the website blurb); fall back to the old combined
    // description for legacy submissions that predate the split.
    const storeDesc = s.storeDescription || s.description || '';
    const whyApplying = (s.storeDescription && s.description) ? s.description : '';
    return `
      <div class="submission-card" data-id="${escapeHtmlAdmin(s.id)}">
        <div class="submission-top">
          <span class="submission-name">${escapeHtmlAdmin(s.name)} <span class="vendor-shop-type">${SHOP_TYPE_LABELS[s.shopType] || s.shopType || ''}</span></span>
          <span class="submission-meta">${escapeHtmlAdmin(when)}</span>
        </div>
        <div class="submission-desc">${escapeHtmlAdmin(storeDesc)}</div>
        <div class="submission-fields">
          ${whyApplying ? `<div><strong>Why applying:</strong> ${escapeHtmlAdmin(whyApplying)}</div>` : ''}
          <div><strong>Contact:</strong> ${escapeHtmlAdmin(s.contactEmail)}</div>
          <div><strong>Country:</strong> ${escapeHtmlAdmin(s.country)} &nbsp;·&nbsp; <strong>Ships to:</strong> ${regions}</div>
          <div><strong>Website:</strong> ${website}</div>
          <div><strong>Nostr:</strong> ${nostr} &nbsp;·&nbsp; <strong>X:</strong> ${x}</div>
        </div>
        <div class="submission-actions">
          <button class="btn primary import-submission">Import as vendor</button>
          <button class="btn dismiss-submission">Dismiss</button>
        </div>
      </div>`;
  }).join('');

  submissionsList.querySelectorAll('.import-submission').forEach(btn => {
    btn.addEventListener('click', () => importSubmission(btn.closest('.submission-card').dataset.id, btn));
  });
  submissionsList.querySelectorAll('.dismiss-submission').forEach(btn => {
    btn.addEventListener('click', () => dismissSubmission(btn.closest('.submission-card').dataset.id, btn));
  });
}

async function importSubmission(id, btn) {
  const submission = pendingSubmissions.find(s => s.id === id);
  if (!submission) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  try {
    const resp = await fetch(`/api/vendors/submissions/${id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      showSubmissionsResult(data.error || 'Import failed.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Import as vendor'; }
      return;
    }
    pendingSubmissions = pendingSubmissions.filter(s => s.id !== id);
    setPendingBadge(pendingSubmissions.length);
    renderVendorSubmissions();
    loadVendors(); // show the newly added (hidden) vendor in the list below
    const warn = data.serverUpdated ? '' : ' (note: could not mark it imported on the server — it may reappear on next refresh)';
    showSubmissionsResult(`Imported "${submission.name}" as a hidden vendor — review it below and enable "Show on Website" to publish.${warn}`, 'success');
  } catch (err) {
    showSubmissionsResult('Import failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Import as vendor'; }
  }
}

async function dismissSubmission(id, btn) {
  const submission = pendingSubmissions.find(s => s.id === id);
  if (!confirm(`Dismiss the application from "${submission ? submission.name : id}"? This permanently deletes it.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Dismissing…'; }
  try {
    const resp = await fetch(`/api/vendors/submissions/${id}/dismiss`, { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      showSubmissionsResult(data.error || 'Dismiss failed.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Dismiss'; }
      return;
    }
    pendingSubmissions = pendingSubmissions.filter(s => s.id !== id);
    setPendingBadge(pendingSubmissions.length);
    renderVendorSubmissions();
  } catch (err) {
    showSubmissionsResult('Dismiss failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Dismiss'; }
  }
}

if (refreshSubmissionsBtn) refreshSubmissionsBtn.addEventListener('click', loadVendorSubmissions);

async function loadVendors() {
  try {
    const resp = await fetch('/api/vendors');
    allVendors = await resp.json();
    renderVendors(allVendors);
  } catch (err) {
    vendorsList.innerHTML = `<p class="error">Failed to load vendors: ${err.message}</p>`;
  }
}

function renderVendorCard(v, index, sectionArr) {
  const isFirst = index === 0;
  const isLast = index === sectionArr.length - 1;
  const logo = v.logoUrl || v.nostrProfilePic || v.xProfilePic;
  const shipping = (v.shippingRegions || []).join(', ') || 'Not specified';
  const shopLabel = SHOP_TYPE_LABELS[v.shopType] || SHOP_TYPE_LABELS.online;

  return `
    <div class="credit-card" data-id="${v.id}">
      <div class="credit-avatar">
        ${logo
          ? `<img src="${logo}" alt="${v.name}" onerror="this.style.display='none'">`
          : `<span>${(v.name || '?')[0].toUpperCase()}</span>`
        }
      </div>
      <div class="credit-info">
        <div class="credit-name">${v.name || 'Unnamed'} <span class="vendor-shop-type">${shopLabel}</span></div>
        <div class="credit-role">${v.country || ''}${v.country && shipping !== 'Not specified' ? ' · Ships to ' + shipping : ''}</div>
        <div class="credit-role">${v.description || ''}</div>
        <div class="credit-links">
          ${v.nostrNpub ? `<a href="https://njump.me/${v.nostrNpub}" target="_blank" title="Nostr" class="social-icon">${ICONS.nostr}</a>` : ''}
          ${v.xProfileUrl ? `<a href="${v.xProfileUrl}" target="_blank" title="X" class="social-icon">${ICONS.x}</a>` : ''}
          ${v.websiteUrl ? `<a href="${v.websiteUrl}" target="_blank" title="Website" class="social-icon">${ICONS.web}</a>` : ''}
          ${!v.showOnWebsite ? '<span class="status-badge hidden">Hidden</span>' : ''}
        </div>
      </div>
      <div class="credit-actions">
        <button class="btn-move move-vendor-up" title="Move up" ${isFirst ? 'disabled' : ''}>▲</button>
        <button class="btn-move move-vendor-down" title="Move down" ${isLast ? 'disabled' : ''}>▼</button>
        <button class="btn-icon edit-vendor" title="Edit">✏️</button>
        <button class="btn-icon delete-vendor" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function renderVendors(vendors) {
  if (vendors.length === 0) {
    vendorsList.innerHTML = '<p class="empty">No vendors yet. Click "Add Vendor" to create one.</p>';
    return;
  }

  // Three sections mirroring the live market page + pending-approval state:
  //   Featured = visible & featured (Pride of the Market)
  //   Regular  = visible & not featured (Responsible Farmers)
  //   Pending  = hidden (showOnWebsite=false, e.g. imported applications)
  const featured = vendors.filter(v => v.showOnWebsite && v.featured);
  const regular = vendors.filter(v => v.showOnWebsite && !v.featured);
  const pending = vendors.filter(v => !v.showOnWebsite);

  const section = (title, arr) => arr.length === 0 ? '' : `
      <div class="credits-section">
        <h3 class="credits-section-title">${title} <span class="credits-section-count">(${arr.length})</span></h3>
        <div class="credits-section-list">${arr.map((v, i, a) => renderVendorCard(v, i, a)).join('')}</div>
      </div>
    `;

  let html = '';
  html += section('⭐ Featured', featured);
  html += section('Regular', regular);
  html += section('Pending Approval', pending);

  vendorsList.innerHTML = html;

  vendorsList.querySelectorAll('.edit-vendor').forEach(btn => {
    btn.addEventListener('click', () => editVendor(btn.closest('.credit-card').dataset.id));
  });
  vendorsList.querySelectorAll('.delete-vendor').forEach(btn => {
    btn.addEventListener('click', () => deleteVendor(btn.closest('.credit-card').dataset.id));
  });
  vendorsList.querySelectorAll('.move-vendor-up').forEach(btn => {
    btn.addEventListener('click', () => moveVendor(btn.closest('.credit-card').dataset.id, 'up'));
  });
  vendorsList.querySelectorAll('.move-vendor-down').forEach(btn => {
    btn.addEventListener('click', () => moveVendor(btn.closest('.credit-card').dataset.id, 'down'));
  });
}

function openVendorModal(vendor = null) {
  vendorModalTitle.textContent = vendor ? 'Edit Vendor' : 'Add Vendor';
  document.getElementById('vendor-id').value = vendor?.id || '';
  document.getElementById('vendor-name').value = vendor?.name || '';
  document.getElementById('vendor-country').value = vendor?.country || '';
  document.getElementById('vendor-shop-type').value = vendor?.shopType || 'online';
  document.getElementById('vendor-description').value = vendor?.description || '';
  document.getElementById('vendor-website-url').value = vendor?.websiteUrl || '';
  document.getElementById('vendor-logo-url').value = vendor?.logoUrl || '';
  document.getElementById('vendor-nostr-npub').value = vendor?.nostrNpub || '';
  document.getElementById('vendor-nostr-pic').value = vendor?.nostrProfilePic || '';
  document.getElementById('vendor-x-url').value = vendor?.xProfileUrl || '';
  if (vendor?.xProfilePic) {
    document.getElementById('vendor-x-pic').value = vendor.xProfilePic;
  } else if (vendor?.xProfileUrl) {
    const username = extractXUsername(vendor.xProfileUrl);
    document.getElementById('vendor-x-pic').value = username ? `https://unavatar.io/twitter/${username}` : '';
  } else {
    document.getElementById('vendor-x-pic').value = '';
  }
  document.getElementById('vendor-show-on-website').checked = vendor?.showOnWebsite !== false;
  document.getElementById('vendor-featured').checked = !!vendor?.featured;

  // Set shipping region checkboxes
  const regions = vendor?.shippingRegions || [];
  document.querySelectorAll('#vendor-form input[name="shipping-region"]').forEach(cb => {
    cb.checked = regions.includes(cb.value);
  });

  // Reset logo upload state and preview the effective logo
  pendingVendorLogoFile = null;
  document.getElementById('vendor-logo-file').value = '';
  updateVendorLogoPreview();

  vendorModal.hidden = false;
}

// The logo shown for a vendor is logoUrl || nostrProfilePic || xProfilePic.
// Keep the modal preview in sync with whichever source is currently set.
function updateVendorLogoPreview() {
  const preview = document.getElementById('vendor-logo-preview');
  const img = document.getElementById('vendor-logo-preview-img');
  if (pendingVendorLogoFile) return; // preview already shows the picked file
  const url = (document.getElementById('vendor-logo-url').value || '').trim()
    || (document.getElementById('vendor-nostr-pic').value || '').trim()
    || (document.getElementById('vendor-x-pic').value || '').trim();
  if (url && url !== 'Loading...') {
    img.src = url;
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }
}

function closeVendorModal() {
  vendorModal.hidden = true;
  vendorForm.reset();
  pendingVendorLogoFile = null;
  document.getElementById('vendor-logo-preview').hidden = true;
}

function editVendor(id) {
  const vendor = allVendors.find(v => v.id === id);
  if (vendor) openVendorModal(vendor);
}

async function deleteVendor(id) {
  const vendor = allVendors.find(v => v.id === id);
  if (!confirm(`Delete vendor "${vendor?.name || 'Unnamed'}"?`)) return;

  try {
    await fetch(`/api/vendors/${id}`, { method: 'DELETE' });
    loadVendors();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

async function moveVendor(id, direction) {
  const vendor = allVendors.find(v => v.id === id);
  if (!vendor) return;

  const section = vendor.showOnWebsite ? 'visible' : 'hidden';
  const sectionVendors = allVendors.filter(v =>
    section === 'visible' ? v.showOnWebsite : !v.showOnWebsite
  );

  const indexInSection = sectionVendors.findIndex(v => v.id === id);
  if (direction === 'up' && indexInSection <= 0) return;
  if (direction === 'down' && indexInSection >= sectionVendors.length - 1) return;

  const swapIndex = direction === 'up' ? indexInSection - 1 : indexInSection + 1;
  [sectionVendors[indexInSection], sectionVendors[swapIndex]] =
    [sectionVendors[swapIndex], sectionVendors[indexInSection]];

  const reordered = [];
  if (section === 'visible') {
    reordered.push(...sectionVendors);
    reordered.push(...allVendors.filter(v => !v.showOnWebsite));
  } else {
    reordered.push(...allVendors.filter(v => v.showOnWebsite));
    reordered.push(...sectionVendors);
  }

  const ids = reordered.map(v => v.id);

  try {
    const resp = await fetch('/api/vendors/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const result = await resp.json();
    if (result.success) {
      allVendors = reordered;
      const query = vendorsSearch.value.toLowerCase();
      if (query) {
        const filtered = allVendors.filter(v =>
          (v.name || '').toLowerCase().includes(query) ||
          (v.description || '').toLowerCase().includes(query) ||
          (v.country || '').toLowerCase().includes(query)
        );
        renderVendors(filtered);
      } else {
        renderVendors(allVendors);
      }
    }
  } catch (err) {
    alert('Failed to reorder: ' + err.message);
  }
}

addVendorBtn.addEventListener('click', () => openVendorModal());
cancelVendorBtn.addEventListener('click', closeVendorModal);
vendorModal.addEventListener('click', e => {
  if (e.target === vendorModal) closeVendorModal();
});

vendorForm.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('vendor-id').value;
  let logoUrl = document.getElementById('vendor-logo-url').value;

  // Upload logo if a file is pending
  if (pendingVendorLogoFile) {
    const formData = new FormData();
    formData.append('logo', pendingVendorLogoFile);
    formData.append('name', document.getElementById('vendor-name').value);

    try {
      const uploadResp = await fetch('/api/vendors/logo', { method: 'POST', body: formData });
      const uploadData = await uploadResp.json();
      if (uploadData.success) {
        logoUrl = uploadData.path;
      } else {
        alert('Failed to upload logo: ' + uploadData.error);
        return;
      }
    } catch (err) {
      alert('Failed to upload logo: ' + err.message);
      return;
    }
  }

  // Collect shipping regions from checkboxes
  const shippingRegions = [];
  document.querySelectorAll('#vendor-form input[name="shipping-region"]:checked').forEach(cb => {
    shippingRegions.push(cb.value);
  });

  const data = {
    name: document.getElementById('vendor-name').value,
    country: document.getElementById('vendor-country').value,
    shippingRegions,
    shopType: document.getElementById('vendor-shop-type').value,
    description: document.getElementById('vendor-description').value,
    websiteUrl: document.getElementById('vendor-website-url').value,
    logoUrl: logoUrl,
    nostrNpub: document.getElementById('vendor-nostr-npub').value,
    nostrProfilePic: document.getElementById('vendor-nostr-pic').value,
    xProfileUrl: document.getElementById('vendor-x-url').value,
    xProfilePic: document.getElementById('vendor-x-pic').value,
    showOnWebsite: document.getElementById('vendor-show-on-website').checked,
    featured: document.getElementById('vendor-featured').checked,
  };

  try {
    if (id) {
      await fetch(`/api/vendors/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    closeVendorModal();
    loadVendors();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

vendorsSearch.addEventListener('input', () => {
  const query = vendorsSearch.value.toLowerCase();
  const filtered = allVendors.filter(v =>
    (v.name || '').toLowerCase().includes(query) ||
    (v.description || '').toLowerCase().includes(query) ||
    (v.country || '').toLowerCase().includes(query)
  );
  renderVendors(filtered);
});

// Vendor logo upload handling
const vendorLogoFileInput = document.getElementById('vendor-logo-file');
const vendorLogoUploadBtn = document.getElementById('vendor-logo-upload-btn');
const vendorLogoPreview = document.getElementById('vendor-logo-preview');
const vendorLogoPreviewImg = document.getElementById('vendor-logo-preview-img');
const vendorLogoClearBtn = document.getElementById('vendor-logo-clear');
const vendorLogoUrlInput = document.getElementById('vendor-logo-url');

vendorLogoUploadBtn.addEventListener('click', () => vendorLogoFileInput.click());

vendorLogoFileInput.addEventListener('change', () => {
  if (vendorLogoFileInput.files[0]) {
    pendingVendorLogoFile = vendorLogoFileInput.files[0];
    const url = URL.createObjectURL(pendingVendorLogoFile);
    vendorLogoPreviewImg.src = url;
    vendorLogoPreview.hidden = false;
    vendorLogoUrlInput.value = '';
  }
});

// Clear the logo source that's currently providing the preview, so the ✕
// works whether the logo comes from logoUrl, the Nostr pic, or the X pic.
vendorLogoClearBtn.addEventListener('click', () => {
  if (pendingVendorLogoFile) {
    pendingVendorLogoFile = null;
    vendorLogoFileInput.value = '';
  } else if (vendorLogoUrlInput.value.trim()) {
    vendorLogoUrlInput.value = '';
  } else if (document.getElementById('vendor-nostr-pic').value.trim()) {
    document.getElementById('vendor-nostr-pic').value = '';
  } else if (document.getElementById('vendor-x-pic').value.trim()) {
    document.getElementById('vendor-x-pic').value = '';
  }
  updateVendorLogoPreview();
});

vendorLogoUrlInput.addEventListener('input', () => {
  if (vendorLogoUrlInput.value.trim()) {
    pendingVendorLogoFile = null;
    vendorLogoFileInput.value = '';
  }
  updateVendorLogoPreview();
});

// Keep the preview live when the Nostr/X picture URLs are edited
document.getElementById('vendor-nostr-pic').addEventListener('input', updateVendorLogoPreview);
document.getElementById('vendor-x-pic').addEventListener('input', updateVendorLogoPreview);

// Re-fetch the Nostr profile picture from the current npub (without retyping it)
document.getElementById('vendor-nostr-refresh').addEventListener('click', async () => {
  const npub = document.getElementById('vendor-nostr-npub').value.trim();
  const picField = document.getElementById('vendor-nostr-pic');
  const hex = npubToHex(npub);
  if (!hex) { alert('Enter a valid npub first.'); return; }
  picField.value = 'Loading...';
  updateVendorLogoPreview();
  try {
    const resp = await fetch(`/api/nostr/profile/${hex}`);
    const profile = await resp.json();
    picField.value = profile.picture || '';
  } catch (err) {
    picField.value = '';
    alert('Failed to fetch Nostr profile: ' + err.message);
  }
  updateVendorLogoPreview();
});

// Sync vendors to website
syncVendorsBtn.addEventListener('click', async () => {
  syncVendorsBtn.disabled = true;
  syncVendorsBtn.textContent = 'Syncing...';

  try {
    const resp = await fetch('/api/vendors/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await resp.json();

    if (data.success) {
      vendorsSyncResult.className = 'result success';
      vendorsSyncResult.innerHTML = `Synced to <strong>${data.path}</strong>: ${data.exported} vendors`;
    } else {
      vendorsSyncResult.className = 'result error';
      vendorsSyncResult.textContent = data.error;
    }
  } catch (err) {
    vendorsSyncResult.className = 'result error';
    vendorsSyncResult.textContent = err.message;
  }

  vendorsSyncResult.hidden = false;
  syncVendorsBtn.disabled = false;
  syncVendorsBtn.textContent = 'Sync to Website';
});

// Load vendors when tab is clicked
document.querySelector('[data-tab="vendors"]').addEventListener('click', loadVendors);

// Auto-populate X profile picture from X URL for vendors
document.getElementById('vendor-x-url').addEventListener('input', e => {
  const url = e.target.value.trim();
  const picField = document.getElementById('vendor-x-pic');
  const username = extractXUsername(url);

  if (username) {
    picField.value = `https://unavatar.io/twitter/${username}`;
  } else {
    picField.value = '';
  }
});

// Auto-fetch Nostr profile pic for vendors
document.getElementById('vendor-nostr-npub').addEventListener('input', async e => {
  const npub = e.target.value.trim();
  const picField = document.getElementById('vendor-nostr-pic');
  const hex = npubToHex(npub);

  if (hex) {
    picField.value = 'Loading...';
    updateVendorLogoPreview();
    try {
      const resp = await fetch(`/api/nostr/profile/${hex}`);
      const profile = await resp.json();
      picField.value = profile.picture || '';
    } catch (err) {
      picField.value = '';
    }
  } else {
    picField.value = '';
  }
  updateVendorLogoPreview();
});

// --- Serial Monitor + Live Screen ---
const smDevice = document.getElementById('serial-device');
const smBaud = document.getElementById('serial-baud');
const smConnectBtn = document.getElementById('serial-connect-btn');
const smStatus = document.getElementById('serial-status');
const smOutput = document.getElementById('serial-output');
const smAutoscroll = document.getElementById('serial-autoscroll');
const smMaxLines = document.getElementById('serial-max-lines');
const smClearBtn = document.getElementById('serial-clear-btn');

const smCaptureBtn = document.getElementById('serial-capture-btn');
const smCapturePath = document.getElementById('serial-capture-path');
const smCaptureFolder = document.getElementById('serial-capture-folder');
const smCaptureFilename = document.getElementById('serial-capture-filename');
const smCaptureTimestamp = document.getElementById('serial-capture-timestamp');

// Restore saved preferences
try {
  const savedFolder = localStorage.getItem('sm_capture_folder');
  if (savedFolder && smCaptureFolder) smCaptureFolder.value = savedFolder;
  const savedFilename = localStorage.getItem('sm_capture_filename');
  if (savedFilename && smCaptureFilename) smCaptureFilename.value = savedFilename;
  const savedTs = localStorage.getItem('sm_capture_timestamp');
  if (savedTs === '1' && smCaptureTimestamp) smCaptureTimestamp.checked = true;
} catch {}

function smBuildCapturePath() {
  let folder = (smCaptureFolder?.value || '~/Downloads').trim().replace(/\/$/, '');
  let filename = (smCaptureFilename?.value || 'device_screen.png').trim();
  if (!filename.toLowerCase().endsWith('.png')) filename += '.png';
  if (smCaptureTimestamp?.checked) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dot = filename.lastIndexOf('.');
    filename = filename.slice(0, dot) + '-' + ts + filename.slice(dot);
  }
  const full = folder + '/' + filename;
  if (smCapturePath) smCapturePath.value = full;
  return full;
}

// Native macOS folder picker via backend
const smFolderBrowseBtn = document.getElementById('serial-folder-browse');
if (smFolderBrowseBtn) {
  smFolderBrowseBtn.addEventListener('click', async () => {
    smFolderBrowseBtn.disabled = true;
    const originalText = smFolderBrowseBtn.textContent;
    smFolderBrowseBtn.textContent = 'Opening…';
    try {
      const res = await fetch('/api/fs/pick-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultPath: smCaptureFolder.value || '~' }),
      });
      if (res.status === 204) return; // user cancelled
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      smCaptureFolder.value = data.display;
      try { localStorage.setItem('sm_capture_folder', data.display); } catch {}
    } catch (err) {
      alert('Folder picker error: ' + err.message);
    } finally {
      smFolderBrowseBtn.disabled = false;
      smFolderBrowseBtn.textContent = originalText;
    }
  });
}

// Persist preferences on change
if (smCaptureFolder) smCaptureFolder.addEventListener('change', () => {
  try { localStorage.setItem('sm_capture_folder', smCaptureFolder.value); } catch {}
});
if (smCaptureFilename) smCaptureFilename.addEventListener('change', () => {
  try { localStorage.setItem('sm_capture_filename', smCaptureFilename.value); } catch {}
});
if (smCaptureTimestamp) smCaptureTimestamp.addEventListener('change', () => {
  try { localStorage.setItem('sm_capture_timestamp', smCaptureTimestamp.checked ? '1' : '0'); } catch {}
});
const smScreenAuto = document.getElementById('serial-screen-auto');
const smScreenInterval = document.getElementById('serial-screen-interval');
const smScreenImg = document.getElementById('serial-screen-img');
const smScreenStatus = document.getElementById('serial-screen-status');

let smSocket = null;
let smScreenTimer = null;

function smSetStatus(text, kind) {
  smStatus.textContent = text;
  smStatus.style.color = kind === 'err' ? '#991b1b' : kind === 'ok' ? '#065f46' : '#666';
}

function smAppend(text) {
  smOutput.appendChild(document.createTextNode(text));
  // Trim to max-lines
  const cap = parseInt(smMaxLines.value, 10) || 500;
  const lines = smOutput.textContent.split('\n');
  if (lines.length > cap) {
    smOutput.textContent = lines.slice(lines.length - cap).join('\n');
  }
  if (smAutoscroll.checked) smOutput.scrollTop = smOutput.scrollHeight;
}

function smConnect() {
  smDisconnect();
  const device = smDevice.value.trim();
  const baud = parseInt(smBaud.value, 10) || 115200;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/api/device/serial?device=${encodeURIComponent(device)}&baud=${baud}`;
  smSetStatus('Connecting…');
  try {
    smSocket = new WebSocket(url);
  } catch (err) {
    smSetStatus('Connect failed: ' + err.message, 'err');
    return;
  }
  smSocket.addEventListener('open', () => {
    smSetStatus(`Connected to ${device} @ ${baud}`, 'ok');
    smConnectBtn.textContent = 'Disconnect';
  });
  smSocket.addEventListener('close', () => {
    smSetStatus('Disconnected');
    smConnectBtn.textContent = 'Connect';
    smSocket = null;
  });
  smSocket.addEventListener('error', () => {
    smSetStatus('Socket error', 'err');
  });
  smSocket.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'data') {
      smAppend(msg.text);
    } else if (msg.type === 'status') {
      if (msg.state === 'open') smSetStatus(`Connected to ${msg.device} @ ${msg.baud}`, 'ok');
      else if (msg.state === 'closed') smSetStatus('Port closed');
      else if (msg.state === 'suspended') smSetStatus('Port released for screenshot…');
    } else if (msg.type === 'error') {
      smSetStatus('Error: ' + msg.message, 'err');
    }
  });
}

function smDisconnect() {
  if (smSocket) {
    try { smSocket.close(); } catch {}
    smSocket = null;
  }
}

smConnectBtn.addEventListener('click', () => {
  if (smSocket && smSocket.readyState === WebSocket.OPEN) smDisconnect();
  else smConnect();
});

smClearBtn.addEventListener('click', () => { smOutput.textContent = ''; });

async function smCaptureScreenshot() {
  smScreenStatus.hidden = false;
  smScreenStatus.className = 'result';
  smScreenStatus.textContent = 'Capturing screenshot… (5–60s)';
  smCaptureBtn.disabled = true;
  try {
    const res = await fetch('/api/device/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device: smDevice.value.trim(),
        savePath: smBuildCapturePath(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    smScreenImg.src = '/api/device/screenshot.png?ts=' + Date.now();
    smScreenImg.hidden = false;
    smScreenStatus.className = 'result success';
    smScreenStatus.textContent = `Saved to ${data.savedAt} (${data.size.toLocaleString()} bytes) at ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    smScreenStatus.className = 'result error';
    smScreenStatus.textContent = 'Error: ' + err.message;
  } finally {
    smCaptureBtn.disabled = false;
  }
}

smCaptureBtn.addEventListener('click', smCaptureScreenshot);

function smToggleScreenAuto() {
  if (smScreenTimer) { clearInterval(smScreenTimer); smScreenTimer = null; }
  if (smScreenAuto.checked) {
    const ms = (parseInt(smScreenInterval.value, 10) || 10) * 1000;
    smScreenTimer = setInterval(smCaptureScreenshot, ms);
    smCaptureScreenshot();
  }
}
smScreenAuto.addEventListener('change', smToggleScreenAuto);
smScreenInterval.addEventListener('change', smToggleScreenAuto);

// Auto-connect on first tab open
let smFirstOpen = true;
document.querySelector('[data-tab="serial-monitor"]').addEventListener('click', () => {
  if (smFirstOpen) {
    smFirstOpen = false;
    smConnect();
  }
});

// --- Sync from GitHub Panel ---
const syncStatusEl = document.getElementById('sync-status');
const syncInfoEl = document.getElementById('sync-info');
const syncRefreshBtn = document.getElementById('sync-refresh-btn');
const syncPullBtn = document.getElementById('sync-pull-btn');
const syncResultEl = document.getElementById('sync-result');
const syncOutputEl = document.getElementById('sync-output');

async function loadSyncStatus() {
  if (!syncStatusEl) return;
  syncStatusEl.innerHTML = '<em style="color:#6b7280;">Fetching remote…</em>';
  if (syncInfoEl) syncInfoEl.textContent = '';
  if (syncPullBtn) syncPullBtn.disabled = true;
  try {
    const res = await fetch('/api/sync/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    renderSyncStatus(data);
  } catch (err) {
    syncStatusEl.innerHTML = `<span style="color:#b91c1c;">Error: ${escapeHtml(err.message)}</span>`;
  }
}

function renderSyncStatus(data) {
  if (syncInfoEl) {
    let info = `Branch: <strong>${escapeHtml(data.branch)}</strong>`;
    if (data.ahead) info += ` · ${data.ahead} ahead`;
    if (data.behind) info += ` · ${data.behind} behind`;
    syncInfoEl.innerHTML = info;
  }

  if (data.behind === 0) {
    syncStatusEl.innerHTML = '<em style="color:#16a34a;">✓ Local is up to date with GitHub.</em>';
    if (syncPullBtn) syncPullBtn.disabled = true;
    return;
  }

  let html = `<div style="font-weight:600; margin-bottom:8px;">${data.behind} new commit(s) on GitHub not yet local:</div>`;
  html += '<div style="display:flex; flex-direction:column; gap:6px;">';
  for (const c of data.remoteCommits) {
    html += `
      <div style="display:flex; gap:8px; align-items:start; padding:6px; background:white; border-radius:6px;">
        <code style="font-size:11px; color:#0891b2; flex-shrink:0;">${escapeHtml(c.shortSha)}</code>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; color:#111827;">${escapeHtml(c.subject)}</div>
          <div style="font-size:11px; color:#6b7280; margin-top:2px;">${escapeHtml(c.author)} · ${escapeHtml(c.when)}</div>
        </div>
      </div>`;
  }
  html += '</div>';

  if (data.hasLocalChanges) {
    html += `<div style="margin-top:12px; padding:8px 12px; background:#fef3c7; border:1px solid #fde68a; border-radius:6px; font-size:12px; color:#92400e;">
      ⚠️ You have local uncommitted changes. They'll be auto-stashed and restored around the pull.
    </div>`;
  }

  syncStatusEl.innerHTML = html;
  if (syncPullBtn) syncPullBtn.disabled = false;
}

if (syncRefreshBtn) syncRefreshBtn.addEventListener('click', loadSyncStatus);

if (syncPullBtn) {
  syncPullBtn.addEventListener('click', async () => {
    syncPullBtn.disabled = true;
    const orig = syncPullBtn.textContent;
    syncPullBtn.textContent = '⏳ Pulling…';
    syncResultEl.hidden = true;
    syncOutputEl.style.display = 'none';

    try {
      const res = await fetch('/api/sync/pull', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      syncResultEl.hidden = false;
      syncResultEl.className = 'result success';
      syncResultEl.innerHTML = '✓ Pulled latest changes from GitHub.' + (data.stashed ? ' Your local changes were auto-stashed and restored.' : '');
      if (data.output) {
        syncOutputEl.textContent = data.output;
        syncOutputEl.style.display = 'block';
      }
      // Reload sync status and deploy status (since local commits may have changed)
      setTimeout(() => { loadSyncStatus(); loadDeployStatus(); }, 500);
    } catch (err) {
      syncResultEl.hidden = false;
      syncResultEl.className = 'result error';
      syncResultEl.textContent = '✗ Pull failed: ' + err.message;
    } finally {
      syncPullBtn.disabled = false;
      syncPullBtn.textContent = orig;
    }
  });
}

// --- Deploy Panel ---
const deployStatusEl = document.getElementById('deploy-status');
const deployBranchEl = document.getElementById('deploy-branch-info');
const deployMessageEl = document.getElementById('deploy-message');
const deployBtn = document.getElementById('deploy-btn');
const deployRefreshBtn = document.getElementById('deploy-refresh-btn');
const deployResultEl = document.getElementById('deploy-result');
const deployOutputEl = document.getElementById('deploy-output');

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function statusCodeLabel(code) {
  const c = code.trim();
  if (c === 'M' || c === 'AM' || c === 'MM') return 'modified';
  if (c === 'D') return 'deleted';
  if (c === 'A') return 'added';
  if (c === 'R') return 'renamed';
  if (c === '??') return 'untracked';
  return c;
}

// Generate a sensible commit message from a list of selected file paths
function generateCommitMessage(files) {
  if (!files || files.length === 0) return '';
  const groups = new Set();
  for (const f of files) {
    if (f.startsWith('src/content/pages/')) {
      const m = f.match(/src\/content\/pages\/([^/]+)\.md$/);
      groups.add(m ? `${m[1]} page` : 'pages');
    } else if (f.startsWith('src/content/guides/')) {
      const m = f.match(/src\/content\/guides\/([^/]+)/);
      groups.add(m ? `${m[1]} guide` : 'guides');
    } else if (f.startsWith('src/content/news/')) {
      groups.add('news');
    } else if (f.startsWith('src/pages/help/')) {
      groups.add('help pages');
    } else if (f.startsWith('src/pages/build/')) {
      groups.add('build pages');
    } else if (f.startsWith('src/pages/community/')) {
      groups.add('community pages');
    } else if (f.startsWith('src/pages/market/')) {
      groups.add('market pages');
    } else if (f.startsWith('src/pages/')) {
      groups.add('pages');
    } else if (f.startsWith('src/components/')) {
      groups.add('components');
    } else if (f.startsWith('src/data/')) {
      groups.add('data');
    } else if (f.startsWith('src/layouts/')) {
      groups.add('layouts');
    } else if (f.startsWith('public/images/wild/')) {
      groups.add('wild gallery');
    } else if (f.startsWith('public/images/showcase/')) {
      groups.add('showcase images');
    } else if (f.startsWith('public/images/email/')) {
      groups.add('email icons');
    } else if (f.startsWith('public/images/')) {
      groups.add('images');
    } else if (f.startsWith('public/')) {
      groups.add('public assets');
    } else if (f.startsWith('netlify/functions/')) {
      groups.add('netlify functions');
    } else if (f.startsWith('tools/admin/')) {
      groups.add('admin tool');
    } else if (f.startsWith('tools/')) {
      groups.add('tools');
    } else if (f === '.gitignore') {
      groups.add('gitignore');
    } else if (f === 'CLAUDE.md') {
      groups.add('CLAUDE.md');
    } else if (f === 'netlify.toml') {
      groups.add('netlify config');
    } else if (f === 'package.json' || f === 'package-lock.json') {
      groups.add('dependencies');
    } else {
      groups.add(f);
    }
  }
  const list = Array.from(groups);
  if (list.length === 1) return `Update ${list[0]}`;
  if (list.length === 2) return `Update ${list[0]} and ${list[1]}`;
  return `Update ${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

// Track whether the user has manually edited the commit message
let _deployMessageEdited = false;

async function loadDeployStatus() {
  if (!deployStatusEl) return;
  deployStatusEl.innerHTML = '<em style="color:#6b7280;">Loading status…</em>';
  try {
    const res = await fetch('/api/deploy/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    const branchText = `Branch: <strong>${escapeHtml(data.branch)}</strong>` +
      (data.ahead ? ` · ${data.ahead} commit(s) ahead of remote` : '') +
      (data.behind ? ` · ${data.behind} behind` : '');
    if (deployBranchEl) deployBranchEl.innerHTML = branchText;

    const total = data.modified.length + data.untracked.length;
    if (total === 0) {
      deployStatusEl.innerHTML = '<em style="color:#16a34a;">✓ Working tree clean - nothing to commit.</em>' +
        (data.ahead ? '<br><strong>You have ' + data.ahead + ' unpushed commit(s).</strong> Click Deploy to push.' : '');
      return;
    }

    const renderRow = (item, defaultChecked) => {
      const label = statusCodeLabel(item.code);
      const colour = item.code.includes('D') ? '#dc2626' : item.code.includes('?') ? '#6b7280' : '#0891b2';
      // Override the global label CSS (margin-bottom:1rem + label input { width:100%; margin-top:.25rem })
      return `
        <label style="display:flex; align-items:center; gap:8px; padding:2px 0; margin:0; font-family:ui-monospace,monospace; font-size:12px; font-weight:normal;">
          <input type="checkbox" class="deploy-file" data-path="${escapeHtml(item.path)}" ${defaultChecked ? 'checked' : ''} style="width:auto; margin:0; padding:0; border:none; border-radius:0; flex-shrink:0;">
          <span style="display:inline-block; width:70px; color:${colour}; flex-shrink:0;">${label}</span>
          <span style="word-break:break-all;">${escapeHtml(item.path)}</span>
        </label>`;
    };

    let html = '';
    if (data.modified.length) {
      html += `<div style="font-weight:600; margin-bottom:6px;">Modified (${data.modified.length}) - recommended</div>`;
      html += data.modified.map(item => renderRow(item, true)).join('');
    }
    if (data.untracked.length) {
      html += `<div style="font-weight:600; margin-top:12px; margin-bottom:6px;">Untracked (${data.untracked.length}) - review carefully</div>`;
      html += data.untracked.map(item => renderRow(item, false)).join('');
    }
    html += `<div style="margin-top:12px; padding-top:12px; border-top:1px solid #e5e7eb;">
      <button type="button" id="deploy-select-all" class="btn" style="font-size:12px; padding:4px 10px; margin-right:6px;">Select all</button>
      <button type="button" id="deploy-select-none" class="btn" style="font-size:12px; padding:4px 10px;">Select none</button>
    </div>`;
    deployStatusEl.innerHTML = html;

    document.getElementById('deploy-select-all')?.addEventListener('click', () => {
      document.querySelectorAll('.deploy-file').forEach(el => { el.checked = true; });
      autoFillCommitMessage();
    });
    document.getElementById('deploy-select-none')?.addEventListener('click', () => {
      document.querySelectorAll('.deploy-file').forEach(el => { el.checked = false; });
      autoFillCommitMessage();
    });
    document.querySelectorAll('.deploy-file').forEach(el => {
      el.addEventListener('change', autoFillCommitMessage);
    });

    // Initial auto-populate based on default selections
    autoFillCommitMessage();
  } catch (err) {
    deployStatusEl.innerHTML = `<span style="color:#b91c1c;">Error loading status: ${escapeHtml(err.message)}</span>`;
  }
}

function autoFillCommitMessage() {
  if (_deployMessageEdited || !deployMessageEl) return;
  const checked = Array.from(document.querySelectorAll('.deploy-file:checked')).map(el => el.dataset.path);
  deployMessageEl.value = generateCommitMessage(checked);
}

if (deployMessageEl) {
  deployMessageEl.addEventListener('input', () => { _deployMessageEdited = true; });
  deployMessageEl.addEventListener('focus', () => {
    // If user clears the field, allow auto-fill again
    if (!deployMessageEl.value.trim()) _deployMessageEdited = false;
  });
}

if (deployRefreshBtn) deployRefreshBtn.addEventListener('click', loadDeployStatus);

if (deployBtn) {
  deployBtn.addEventListener('click', async () => {
    const message = (deployMessageEl?.value || '').trim();
    const files = Array.from(document.querySelectorAll('.deploy-file:checked')).map(el => el.dataset.path);

    if (!message) {
      alert('Please enter a commit message.');
      deployMessageEl?.focus();
      return;
    }

    deployBtn.disabled = true;
    const orig = deployBtn.textContent;
    deployBtn.textContent = '⏳ Deploying…';
    deployResultEl.hidden = true;
    deployOutputEl.style.display = 'none';

    try {
      let res, data;
      if (files.length > 0) {
        res = await fetch('/api/deploy/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, files }),
        });
      } else {
        // Push only
        res = await fetch('/api/deploy/push-only', { method: 'POST' });
      }
      data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      deployResultEl.hidden = false;
      deployResultEl.className = 'result success';
      deployResultEl.innerHTML = `✓ Deployed! Netlify will build and publish in 1-2 minutes. <a href="https://app.netlify.com/sites/lightningpiggy/deploys" target="_blank" rel="noopener">View deploy →</a>`;
      if (data.output) {
        deployOutputEl.textContent = data.output;
        deployOutputEl.style.display = 'block';
      }
      deployMessageEl.value = '';
      _deployMessageEdited = false;
      // Reload status
      setTimeout(loadDeployStatus, 500);
    } catch (err) {
      deployResultEl.hidden = false;
      deployResultEl.className = 'result error';
      deployResultEl.textContent = '✗ Deploy failed: ' + err.message;
    } finally {
      deployBtn.disabled = false;
      deployBtn.textContent = orig;
    }
  });
}

// ─── OG Previews ──────────────────────────────────────────────────────────
let _ogPreviewCache = null;
const _ogFilters = { group: 'all', issues: 'all', search: '' };
const PROD_HOSTNAME = 'lightningpiggy.com';

function ogEscapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function ogEscapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ogPageHasIssues(r) {
  const og = r.og || {};
  if (og.image && og.imageOk === false) return true;
  if (!og.image) return true;
  if (!og.title) return true;
  if (!og.description) return true;
  return false;
}

function ogResultMatchesFilters(r) {
  if (_ogFilters.group !== 'all' && r.group !== _ogFilters.group) return false;
  if (_ogFilters.issues === 'issues' && !ogPageHasIssues(r)) return false;
  if (_ogFilters.issues === 'ok' && ogPageHasIssues(r)) return false;
  if (_ogFilters.search) {
    const q = _ogFilters.search;
    const hay = ((r.label || '') + ' ' + (r.path || '') + ' ' + (r.og?.title || '')).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

async function loadOgPreview(force = false) {
  const list = document.getElementById('og-preview-list');
  const summary = document.getElementById('og-preview-summary');
  if (!list) return;
  if (!force && _ogPreviewCache) {
    renderOgPreview(_ogPreviewCache);
    return;
  }
  list.innerHTML = '<p style="color:#888; text-align:center; padding:40px; grid-column:1/-1;">Scraping every page&hellip;</p>';
  if (summary) summary.textContent = '';
  try {
    const res = await fetch('/api/og-preview');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    _ogPreviewCache = data.results;
    renderOgPreview(data.results);
  } catch (err) {
    list.innerHTML = `<p style="color:#b91c1c; text-align:center; padding:40px; grid-column:1/-1;">Failed to load: ${ogEscapeHtml(err.message)}</p><p style="color:#666; text-align:center; font-size:13px;">Make sure the Astro dev server is running on port 4321.</p>`;
  }
}

function renderOgPreview(results) {
  const list = document.getElementById('og-preview-list');
  const summary = document.getElementById('og-preview-summary');
  if (!list) return;

  const ok = results.filter(r => r.og?.imageOk).length;
  const broken = results.filter(r => r.og?.image && r.og.imageOk === false).length;
  const noImg = results.filter(r => !r.og?.image).length;
  const noTitle = results.filter(r => !r.og?.title).length;
  const needsDeploy = results.filter(r => {
    const og = r.og || {};
    if (!og.imageOk) return false;
    if (og.liveImageOk === false) return true;
    if (typeof og.localImageBytes === 'number' && typeof og.liveImageBytes === 'number'
        && og.localImageBytes !== og.liveImageBytes) return true;
    return false;
  }).length;

  const filtered = results.filter(ogResultMatchesFilters);
  const filterSuffix = filtered.length !== results.length
    ? ` &nbsp;<span style="color:#e91e8c;">${filtered.length} match current filters.</span>`
    : '';

  if (summary) {
    summary.innerHTML = `
      <strong>${results.length}</strong> pages.
      <span style="color:#16a34a;">${ok} local images OK</span>
      ${broken > 0 ? `· <span style="color:#b91c1c;">${broken} broken locally</span>` : ''}
      ${noImg > 0 ? `· <span style="color:#92400e;">${noImg} no og:image</span>` : ''}
      ${noTitle > 0 ? `· <span style="color:#92400e;">${noTitle} no og:title</span>` : ''}
      ${needsDeploy > 0 ? `· <span style="color:#92400e;">${needsDeploy} need deploy</span>` : ''}
      ${filterSuffix}
      &nbsp;&nbsp;<span style="color:#999;">Click any card for raw tags &amp; JSON-LD.</span>
    `;
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="og-grid-empty">No pages match the current filters.</div>';
    return;
  }

  const groups = {};
  for (const r of filtered) {
    const g = r.group || 'Other';
    (groups[g] = groups[g] || []).push(r);
  }
  list.innerHTML = Object.entries(groups).map(([group, items]) => `
    <div class="og-group-header">${ogEscapeHtml(group)} (${items.length})</div>
    ${items.map(renderOgCard).join('')}
  `).join('');

  list.querySelectorAll('.og-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.og-card-link')) return;
      const idx = parseInt(card.dataset.idx, 10);
      if (Number.isFinite(idx)) showOgDetail(_ogPreviewCache[idx]);
    });
  });
}

function ogCardKind(r) {
  if (r.group === 'News') return { label: 'Article', cls: 'og-card-kind-article' };
  return { label: r.label || 'Page', cls: 'og-card-kind-page' };
}

function renderOgCard(r) {
  const og = r.og || {};
  const cacheIdx = _ogPreviewCache.indexOf(r);
  const titleLen = (og.title || '').length;
  const descLen = (og.description || '').length;
  const kind = ogCardKind(r);

  const badges = [];
  if (og.image && og.imageOk) badges.push('<span class="og-badge og-badge-ok">img ok</span>');
  else if (og.image && og.imageOk === false) badges.push(`<span class="og-badge og-badge-err">img ${og.imageStatus || '404'}</span>`);
  else badges.push('<span class="og-badge og-badge-warn">no img</span>');

  const localBytes = og.localImageBytes;
  const liveBytes = og.liveImageBytes;
  const liveStale = og.imageOk && (
    og.liveImageOk === false ||
    (typeof localBytes === 'number' && typeof liveBytes === 'number' && localBytes !== liveBytes)
  );
  if (liveStale) {
    badges.push('<span class="og-badge og-badge-warn" title="The local copy differs from production - Deploy to push it live">needs deploy</span>');
  }
  if (!og.title) badges.push('<span class="og-badge og-badge-warn">no title</span>');
  else if (titleLen > 60) badges.push(`<span class="og-badge og-badge-warn">title ${titleLen}c</span>`);
  if (!og.description) badges.push('<span class="og-badge og-badge-warn">no desc</span>');
  else if (descLen > 200) badges.push(`<span class="og-badge og-badge-warn">desc ${descLen}c</span>`);
  if (og.jsonLd && og.jsonLd.length > 1) badges.push(`<span class="og-badge og-badge-info">JSON-LD ×${og.jsonLd.length}</span>`);
  if (og.twitterCard) badges.push(`<span class="og-badge og-badge-info">${og.twitterCard}</span>`);

  const cardImage = og.displayImage || og.image;
  const imgStyle = cardImage && og.imageOk
    ? `background-image: url('${ogEscapeAttr(cardImage)}');`
    : '';
  const imgClass = cardImage && og.imageOk === false ? 'og-card-image broken' : 'og-card-image';
  let imgFallback = '';
  if (!cardImage) {
    imgFallback = 'no og:image';
  } else if (og.imageOk === false) {
    imgFallback = `image ${og.imageStatus || '404'}<br><span class="og-image-url">${ogEscapeHtml(cardImage)}</span>`;
  }

  return `
    <div class="og-card" data-idx="${cacheIdx}">
      <div class="${imgClass}" style="${imgStyle}">${imgFallback}</div>
      <span class="og-card-kind ${kind.cls}" title="${ogEscapeAttr(kind.label)}">${ogEscapeHtml(kind.label)}</span>
      <div class="og-card-body">
        <div class="og-card-domain">${ogEscapeHtml(PROD_HOSTNAME + (r.path || '/'))}</div>
        <div class="og-card-title">${ogEscapeHtml(og.title || '(no title)')}</div>
        <div class="og-card-desc">${ogEscapeHtml(og.description || '(no description)')}</div>
      </div>
      <div class="og-card-footer">
        <div class="og-card-badges">${badges.join('')}</div>
        <a class="og-card-link" href="${ogEscapeAttr(r.url || '#')}" target="_blank" rel="noopener">open ↗</a>
      </div>
    </div>
  `;
}

function showOgDetail(r) {
  if (!r) return;
  const og = r.og || {};
  let modal = document.getElementById('og-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'og-detail-modal';
    modal.className = 'og-detail-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="og-detail-content">
        <button class="og-detail-close" type="button" aria-label="Close">&times;</button>
        <div id="og-detail-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('.og-detail-close')) {
        modal.setAttribute('aria-hidden', 'true');
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') modal.setAttribute('aria-hidden', 'true');
    });
  }
  const body = document.getElementById('og-detail-body');
  body.innerHTML = `
    <h3>${ogEscapeHtml(r.label || og.title || r.path)}</h3>
    <div class="url">${ogEscapeHtml(r.url)}</div>
    <dl>
      <dt>og:title</dt><dd>${ogEscapeHtml(og.title || '-')}</dd>
      <dt>og:description</dt><dd>${ogEscapeHtml(og.description || '-')}</dd>
      <dt>og:image</dt><dd>
        ${og.image ? `<a href="${ogEscapeAttr(og.image)}" target="_blank" style="color:#e91e8c;">${ogEscapeHtml(og.image)}</a>` : '-'}
        ${og.image ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
          <span class="og-badge ${og.imageOk ? 'og-badge-ok' : 'og-badge-err'}">local ${og.imageOk ? 'ok' : (og.imageStatus || '404')}</span>
          ${og.liveImageStatus !== undefined ? `<span class="og-badge ${og.liveImageOk ? 'og-badge-ok' : 'og-badge-err'}">live ${og.liveImageOk ? 'ok' : (og.liveImageStatus || '404')}</span>` : ''}
        </div>` : ''}
      </dd>
      <dt>og:image:alt</dt><dd>${ogEscapeHtml(og.imageAlt || '-')}</dd>
      <dt>og:type</dt><dd>${ogEscapeHtml(og.type || '-')}</dd>
      <dt>og:site_name</dt><dd>${ogEscapeHtml(og.siteName || '-')}</dd>
      <dt>twitter:card</dt><dd>${ogEscapeHtml(og.twitterCard || '-')}</dd>
    </dl>
    ${(og.jsonLd || []).map((block, i) => `
      <div style="font-size:12px; color:#888; margin-bottom:4px;">JSON-LD #${i + 1} - ${ogEscapeHtml(block['@type'] || 'unknown')}</div>
      <pre>${ogEscapeHtml(JSON.stringify(block, null, 2))}</pre>
    `).join('')}
  `;
  modal.setAttribute('aria-hidden', 'false');
}

function _ogActivatePill(groupEl, btn) {
  groupEl.querySelectorAll('.og-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
}
document.getElementById('og-filter-group')?.addEventListener('click', e => {
  const btn = e.target.closest('.og-filter-btn');
  if (!btn) return;
  _ogFilters.group = btn.dataset.filter;
  _ogActivatePill(btn.parentElement, btn);
  if (_ogPreviewCache) renderOgPreview(_ogPreviewCache);
});
document.getElementById('og-filter-issues')?.addEventListener('click', e => {
  const btn = e.target.closest('.og-filter-btn');
  if (!btn) return;
  _ogFilters.issues = btn.dataset.issues;
  _ogActivatePill(btn.parentElement, btn);
  if (_ogPreviewCache) renderOgPreview(_ogPreviewCache);
});
document.getElementById('og-filter-search')?.addEventListener('input', e => {
  _ogFilters.search = (e.target.value || '').trim().toLowerCase();
  if (_ogPreviewCache) renderOgPreview(_ogPreviewCache);
});
document.getElementById('og-refresh-btn')?.addEventListener('click', () => loadOgPreview(true));

// Hook into existing tab listener
document.querySelectorAll('.tab').forEach(tab => {
  if (tab.dataset.tab === 'og-preview') tab.addEventListener('click', () => loadOgPreview(false));
});
