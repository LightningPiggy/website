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
  wildPreviewInfo.textContent = `${file.name} — ${(file.size / 1024).toFixed(0)}KB`;
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
  showcasePreviewInfo.textContent = `${file.name} — ${(file.size / 1024).toFixed(0)}KB`;
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

// --- News Post ---
const newsTitle = document.getElementById('news-title');
const newsSlug = document.getElementById('news-slug');
const newsDate = document.getElementById('news-date');
const newsForm = document.getElementById('news-form');
const newsResult = document.getElementById('news-result');

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
  const formData = new FormData(newsForm);
  const submitBtn = newsForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Publishing...';

  try {
    const resp = await fetch('/api/news/publish', { method: 'POST', body: formData });
    const data = await resp.json();

    if (data.success) {
      newsResult.className = 'result success';
      newsResult.innerHTML = `Published! View at <strong>${data.path}</strong> (restart dev server to see it)`;
    } else {
      newsResult.className = 'result error';
      newsResult.textContent = data.error;
    }
  } catch (err) {
    newsResult.className = 'result error';
    newsResult.textContent = err.message;
  }

  newsResult.hidden = false;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Publish';
});

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

async function loadCredits() {
  try {
    const resp = await fetch('/api/credits');
    allCredits = await resp.json();
    renderCredits(allCredits);
  } catch (err) {
    creditsList.innerHTML = `<p class="error">Failed to load credits: ${err.message}</p>`;
  }
}

function renderCredits(credits) {
  if (credits.length === 0) {
    creditsList.innerHTML = '<p class="empty">No credits yet. Click "Add Credit" to create one.</p>';
    return;
  }

  creditsList.innerHTML = credits.map(c => `
    <div class="credit-card" data-id="${c.id}">
      <div class="credit-avatar">
        ${c.nostrProfilePic || c.xProfilePic
          ? `<img src="${c.nostrProfilePic || c.xProfilePic}" alt="${c.name}" onerror="this.style.display='none'">`
          : `<span>${(c.name || '?')[0].toUpperCase()}</span>`
        }
      </div>
      <div class="credit-info">
        <div class="credit-name">
          ${c.isBitcoinKid ? '<span class="bitcoin-kid-star">⭐</span>' : ''}
          ${c.name || 'Unnamed'}
          ${c.showOnWebsite ? `<span class="credit-badge on-website">${c.websiteSection || 'On Website'}</span>` : ''}
        </div>
        <div class="credit-role">${c.role || ''}</div>
        <div class="credit-details">
          ${c.email ? `<span title="Email">${c.email}</span>` : ''}
          ${c.lightningAddress ? `<span title="Lightning">⚡ ${c.lightningAddress}</span>` : ''}
        </div>
        <div class="credit-links">
          ${c.nostrNpub ? `<a href="https://njump.me/${c.nostrNpub}" target="_blank" title="Nostr">Nostr</a>` : ''}
          ${c.xProfileUrl ? `<a href="${c.xProfileUrl}" target="_blank" title="X">X</a>` : ''}
        </div>
      </div>
      <div class="credit-actions">
        <button class="btn-icon edit-credit" title="Edit">✏️</button>
        <button class="btn-icon delete-credit" title="Delete">🗑️</button>
      </div>
    </div>
  `).join('');

  // Attach event listeners
  creditsList.querySelectorAll('.edit-credit').forEach(btn => {
    btn.addEventListener('click', () => editCredit(btn.closest('.credit-card').dataset.id));
  });
  creditsList.querySelectorAll('.delete-credit').forEach(btn => {
    btn.addEventListener('click', () => deleteCredit(btn.closest('.credit-card').dataset.id));
  });
}

function openModal(credit = null) {
  modalTitle.textContent = credit ? 'Edit Credit' : 'Add Credit';
  document.getElementById('credit-id').value = credit?.id || '';
  document.getElementById('credit-name').value = credit?.name || '';
  document.getElementById('credit-email').value = credit?.email || '';
  document.getElementById('credit-role').value = credit?.role || '';
  document.getElementById('credit-lightning').value = credit?.lightningAddress || '';
  document.getElementById('credit-nostr-npub').value = credit?.nostrNpub || '';
  document.getElementById('credit-nostr-hex').value = credit?.nostrHex || '';
  document.getElementById('credit-nostr-pic').value = credit?.nostrProfilePic || '';
  document.getElementById('credit-x-url').value = credit?.xProfileUrl || '';
  document.getElementById('credit-x-pic').value = credit?.xProfilePic || '';
  document.getElementById('credit-notes').value = credit?.notes || '';
  document.getElementById('credit-show-on-website').checked = credit?.showOnWebsite || false;
  document.getElementById('credit-website-section').value = credit?.websiteSection || '';
  document.getElementById('credit-bitcoin-kid').checked = credit?.isBitcoinKid || false;
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

addCreditBtn.addEventListener('click', () => openModal());
cancelCreditBtn.addEventListener('click', closeModal);
creditModal.addEventListener('click', e => {
  if (e.target === creditModal) closeModal();
});

creditForm.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('credit-id').value;
  const data = {
    name: document.getElementById('credit-name').value,
    email: document.getElementById('credit-email').value,
    role: document.getElementById('credit-role').value,
    lightningAddress: document.getElementById('credit-lightning').value,
    nostrNpub: document.getElementById('credit-nostr-npub').value,
    nostrHex: document.getElementById('credit-nostr-hex').value,
    nostrProfilePic: document.getElementById('credit-nostr-pic').value,
    xProfileUrl: document.getElementById('credit-x-url').value,
    xProfilePic: document.getElementById('credit-x-pic').value,
    notes: document.getElementById('credit-notes').value,
    showOnWebsite: document.getElementById('credit-show-on-website').checked,
    websiteSection: document.getElementById('credit-website-section').value,
    isBitcoinKid: document.getElementById('credit-bitcoin-kid').checked,
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

creditsSearch.addEventListener('input', () => {
  const query = creditsSearch.value.toLowerCase();
  const filtered = allCredits.filter(c =>
    (c.name || '').toLowerCase().includes(query) ||
    (c.email || '').toLowerCase().includes(query) ||
    (c.role || '').toLowerCase().includes(query) ||
    (c.notes || '').toLowerCase().includes(query)
  );
  renderCredits(filtered);
});

// Sync credits to website
syncCreditsBtn.addEventListener('click', async () => {
  syncCreditsBtn.disabled = true;
  syncCreditsBtn.textContent = 'Syncing...';

  // Get enabled sections from checkboxes
  const sections = [];
  if (document.getElementById('sync-core-team').checked) sections.push('Core Team');
  if (document.getElementById('sync-contributor').checked) sections.push('Contributor');
  if (document.getElementById('sync-special-thanks').checked) sections.push('Special Thanks');

  try {
    const resp = await fetch('/api/credits/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections }),
    });
    const data = await resp.json();

    if (data.success) {
      syncResult.className = 'result success';
      syncResult.innerHTML = `Synced to <strong>${data.path}</strong>: ${data.exported.coreTeam} Core Team, ${data.exported.contributors} Contributors, ${data.exported.specialThanks} Special Thanks`;
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

// Load credits when tab is clicked
document.querySelector('[data-tab="credits"]').addEventListener('click', loadCredits);
