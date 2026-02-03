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
