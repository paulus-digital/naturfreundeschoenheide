// ============================================
// CONFIGURATION – These are fixed for this site
// ============================================
const GITHUB_REPO = 'paulus-digital/naturfreundeschoenheide';
const GITHUB_BRANCH = 'data-sync';

// Global Admin State
let authData = {
  token: ''
};

let pageData = {};
let currentFileSha = '';
let activeTab = 'general';

document.addEventListener('DOMContentLoaded', () => {
  checkSavedAuth();
  setupStatusToggle();
});

// Check if credentials exist in localStorage
async function checkSavedAuth() {
  const saved = localStorage.getItem('spartenheim_auth_secure');
  if (saved) {
    try {
      const decoded = decodeURIComponent(escape(atob(saved)));
      const parsed = JSON.parse(decoded);
      if (parsed.u && parsed.p) {
        // Auto fill and authenticate
        document.getElementById('admin-username').value = parsed.u;
        document.getElementById('admin-password').value = parsed.p;
        const mockEvent = { preventDefault: () => {} };
        await handleLogin(mockEvent);
      }
    } catch (e) {
      localStorage.removeItem('spartenheim_auth_secure');
    }
  }
}

// Login Handler using Firebase Authentication API
async function handleLogin(event) {
  event.preventDefault();
  
  const userField = document.getElementById('admin-username').value.trim();
  const passField = document.getElementById('admin-password').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  showToast('🔑 Melde an...', 'info');

  try {
    // 1. Fetch config locally/raw to get firebaseUrl & apiKey
    let firebaseUrl = '';
    let apiKey = '';
    try {
      const configRes = await fetch('data.json');
      if (configRes.ok) {
        const config = await configRes.json();
        firebaseUrl = config.firebase ? config.firebase.url : '';
        apiKey = config.firebase ? config.firebase.apiKey : '';
      }
    } catch (e) {
      console.warn('Lokal config fetch failed, using fallback.');
    }

    if (!firebaseUrl) {
      firebaseUrl = 'https://naturfreundeschoenheide-default-rtdb.europe-west1.firebasedatabase.app';
    }
    if (!apiKey) {
      apiKey = 'AIzaSyAMH7xsRU0XxI7IVyI3iULUcfsIo6DNbpA';
    }

    // Ensure URL has no trailing slash
    if (firebaseUrl.endsWith('/')) firebaseUrl = firebaseUrl.slice(0, -1);

    // 2. Map simple username to email
    let email = userField;
    if (!email.includes('@')) {
      email = `${email.toLowerCase()}@naturfreundeschoenheide.de`;
    }

    // 3. Authenticate with Firebase Authentication API
    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: passField,
        returnSecureToken: true
      })
    });

    if (!authResponse.ok) {
      const authErrJson = await authResponse.json();
      const code = authErrJson.error ? authErrJson.error.message : '';
      if (code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD' || code === 'INVALID_LOGIN_ATTEMPT') {
        throw new Error('Falscher Benutzername/E-Mail oder falsches Passwort.');
      } else {
        throw new Error(`Login-Fehler: ${code || authResponse.statusText}`);
      }
    }

    const authJson = await authResponse.json();
    authData.token = authJson.idToken;

    // Save auth data if "remember me" is checked
    const rememberCheckbox = document.getElementById('remember-login');
    if (!rememberCheckbox || rememberCheckbox.checked) {
      const creds = btoa(unescape(encodeURIComponent(JSON.stringify({ u: userField, p: passField }))));
      localStorage.setItem('spartenheim_auth_secure', creds);
    } else {
      localStorage.removeItem('spartenheim_auth_secure');
    }
    
    // Now fetch database records
    await connectToFirebase(firebaseUrl);
  } catch (error) {
    console.error(error);
    errorEl.textContent = error.message;
    errorEl.style.display = 'block';
    showToast('❌ Anmeldung fehlgeschlagen', 'error');
  }
}

// Connect to Firebase Realtime Database
async function connectToFirebase(firebaseUrl) {
  showToast('🔄 Verbinde mit Datenbank...', 'info');
  
  try {
    const response = await fetch(`${firebaseUrl}/data.json?auth=${authData.token}`);

    if (!response.ok) {
      throw new Error(`Datenbank-Verbindungsfehler: ${response.statusText}`);
    }

    let dbData = await response.json();

    // If database is empty, initialize it with default data.json
    if (!dbData) {
      showToast('🆕 Initialisiere leere Datenbank...', 'info');
      const localRes = await fetch('data.json');
      if (localRes.ok) {
        dbData = await localRes.json();
        // Save to Firebase for the first time
        await fetch(`${firebaseUrl}/data.json?auth=${authData.token}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dbData)
        });
      }
    }

    pageData = dbData;
    
    // Show Dashboard
    showDashboard();
    showToast('✅ Erfolgreich angemeldet!', 'success');
  } catch (error) {
    console.error(error);
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = error.message;
    errorEl.style.display = 'block';
    showToast('❌ Datenbank-Verbindung fehlgeschlagen', 'error');
  }
}

// Logout
function logout() {
  localStorage.removeItem('spartenheim_auth');
  document.getElementById('dashboard-container').style.display = 'none';
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('logout-btn').style.display = 'none';
}

// Show Dashboard Panel
function showDashboard() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('dashboard-container').style.display = 'grid';
  document.getElementById('logout-btn').style.display = 'block';

  // Fill Forms
  populateGeneralTab();
  populateHoursTab();
  populateCalendarTab();
  populateGalleryTab();
  populateGuestbookTab();
  populateSettingsTab();
}

// Switch Sidebar Tabs
function switchTab(tabId) {
  activeTab = tabId;
  
  // Update Buttons
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = Array.from(document.querySelectorAll('.admin-tab-btn')).find(btn => 
    btn.getAttribute('onclick').includes(tabId)
  );
  if (activeBtn) activeBtn.classList.add('active');

  // Update Sections
  document.querySelectorAll('.panel-section').forEach(sec => {
    sec.classList.remove('active');
  });
  document.getElementById(`panel-${tabId}`).classList.add('active');
}

// Setup Event Listeners for controls
function setupStatusToggle() {
  const toggle = document.getElementById('admin-status-toggle');
  const label = document.getElementById('admin-status-label');
  
  if (toggle) {
    toggle.addEventListener('change', async () => {
      if (toggle.checked) {
        label.textContent = 'Geöffnet';
        label.style.color = 'var(--success)';
      } else {
        label.textContent = 'Geschlossen';
        label.style.color = 'var(--danger)';
      }
      // Auto-save the status immediately when toggled
      await saveGeneralData();
    });
  }

  // Auto-save banner toggle
  const bannerToggle = document.getElementById('admin-banner-toggle');
  if (bannerToggle) {
    bannerToggle.addEventListener('change', async () => {
      await saveGeneralData();
    });
  }

  // Auto-save banner text on change or blur
  const bannerText = document.getElementById('admin-banner-text');
  if (bannerText) {
    bannerText.addEventListener('change', async () => {
      await saveGeneralData();
    });
  }

  // Auto-save contact fields on change
  ['admin-contact-phone', 'admin-contact-email', 'admin-contact-inhaber'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        await saveGeneralData();
      });
    }
  });
}

// ----------------------------------------------------
// TAB FILLING LOGIC
// ----------------------------------------------------

function populateGeneralTab() {
  document.getElementById('admin-status-toggle').checked = pageData.openStatus;
  const label = document.getElementById('admin-status-label');
  label.textContent = pageData.openStatus ? 'Geöffnet' : 'Geschlossen';
  label.style.color = pageData.openStatus ? 'var(--success)' : 'var(--danger)';

  document.getElementById('admin-banner-toggle').checked = pageData.banner ? pageData.banner.visible : false;
  document.getElementById('admin-banner-text').value = pageData.banner ? pageData.banner.text : '';

  if (pageData.contact) {
    document.getElementById('admin-contact-phone').value = pageData.contact.phone || '';
    document.getElementById('admin-contact-email').value = pageData.contact.email || '';
    document.getElementById('admin-contact-inhaber').value = pageData.contact.inhaber || '';
  }
}

function populateHoursTab() {
  const container = document.getElementById('admin-hours-fields');
  if (!container || !pageData.openingHours) return;

  container.innerHTML = '';
  pageData.openingHours.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'form-group';
    row.style.marginBottom = '12px';
    row.innerHTML = `
      <label style="font-weight: 600;">${item.day}</label>
      <input type="text" id="hour-day-${index}" class="form-control" value="${item.hours}">
    `;
    container.appendChild(row);

    // Attach change listener for auto-saving opening hours
    const input = row.querySelector('input');
    if (input) {
      input.addEventListener('change', async () => {
        await saveHoursData();
      });
    }
  });
}

function populateCalendarTab() {
  const list = document.getElementById('admin-calendar-list');
  if (!list) return;

  list.innerHTML = '';
  
  if (!pageData.planner || pageData.planner.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding: 15px;">Keine Einträge vorhanden.</p>';
    return;
  }

  // Sort by start date
  const sorted = [...pageData.planner].sort((a, b) => new Date(a.startDate || a.date) - new Date(b.startDate || b.date));

  sorted.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'admin-item-row';
    
    // Status translation for badge
    const statusText = {
      'open': 'Offen', 'booked': 'Ausgebucht', 'closed': 'Geschlossen',
      'holiday': 'Urlaub', 'reservation': 'Reservierung möglich', 'event': 'Event'
    }[item.status] || item.status;

    const start = new Date(item.startDate || item.date);
    const end = new Date(item.endDate || item.startDate || item.date);

    const startStr = start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const endStr = end.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const formattedDate = item.endDate && item.endDate !== item.startDate
      ? `${startStr} - ${endStr}`
      : startStr;

    row.innerHTML = `
      <div class="admin-item-details">
        <span class="admin-item-date" style="font-size:0.9rem; font-weight:700;">${formattedDate}</span>
        <span class="admin-item-label">${escapeHTML(item.label)} (${statusText})</span>
      </div>
      <button class="admin-btn admin-btn-danger" style="padding: 6px 12px; font-size: 0.85rem;" onclick="deleteCalendarEntry(${index})">Löschen</button>
    `;
    list.appendChild(row);
  });
}

function populateGalleryTab() {
  const grid = document.getElementById('admin-gallery-grid');
  if (!grid) return;

  grid.innerHTML = '';
  
  if (!pageData.gallery || pageData.gallery.length === 0) {
    grid.innerHTML = '<p class="text-muted" style="padding: 15px; grid-column: 1/-1;">Keine Galeriebilder vorhanden.</p>';
    return;
  }

  pageData.gallery.forEach((img, index) => {
    const card = document.createElement('div');
    card.className = 'gallery-admin-card';
    card.innerHTML = `
      <img src="${img.src}" alt="${img.alt || 'Galerie'}" onerror="this.src='logo.png'; this.style.objectFit='contain';">
      <div class="gallery-admin-actions">
        <p style="font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px;">${img.alt || 'Bild'}</p>
        <button class="admin-btn admin-btn-danger" style="padding: 4px 10px; font-size: 0.8rem; width: 100%;" onclick="deleteGalleryImage(${index})">Entfernen</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function populateGuestbookTab() {
  const list = document.getElementById('admin-reviews-list');
  if (!list) return;

  list.innerHTML = '';
  
  if (!pageData.guestbook || pageData.guestbook.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding: 15px;">Keine Gästebucheinträge vorhanden.</p>';
    return;
  }

  // Reverse list to show newest on top
  const reversed = [...pageData.guestbook].reverse();

  reversed.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'review-admin-card';
    
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    const approvedBtnText = r.approved ? 'Ausblenden' : 'Freigeben';
    const approvedBtnColor = r.approved ? 'var(--warning)' : 'var(--success)';
    
    // Find index in original array
    const originalIndex = pageData.guestbook.findIndex(item => item.id === r.id);

    card.innerHTML = `
      <div class="review-admin-header">
        <div>
          <strong>${escapeHTML(r.name)}</strong>
          <span style="color: var(--accent); margin-left: 8px;">${stars}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 10px;">${r.date}</span>
        </div>
        <div>
          <button class="admin-btn" style="background-color: ${approvedBtnColor}; color: white; padding: 4px 10px; font-size: 0.8rem;" onclick="toggleReviewApproval(${originalIndex})">
            ${approvedBtnText}
          </button>
          <button class="admin-btn admin-btn-danger" style="padding: 4px 10px; font-size: 0.8rem;" onclick="deleteReview(${originalIndex})">
            Löschen
          </button>
        </div>
      </div>
      <p style="font-style: italic; margin-top: 8px;">"${escapeHTML(r.comment)}"</p>
    `;
    list.appendChild(card);
  });
}

// ----------------------------------------------------
// SAVE ACTIONS
// ----------------------------------------------------

// Commit entire pageData back to Firebase Realtime Database
async function commitDataChange(logMessage) {
  showToast('💾 Speichere Änderungen...', 'info');

  try {
    let firebaseUrl = pageData.firebase ? pageData.firebase.url : '';
    if (!firebaseUrl) {
      const configRes = await fetch('data.json');
      if (configRes.ok) {
        const config = await configRes.json();
        firebaseUrl = config.firebase ? config.firebase.url : '';
      }
    }
    if (!firebaseUrl) {
      firebaseUrl = 'https://naturfreundeschoenheide-default-rtdb.europe-west1.firebasedatabase.app';
    }
    if (firebaseUrl.endsWith('/')) firebaseUrl = firebaseUrl.slice(0, -1);

    let response = await fetch(`${firebaseUrl}/data.json?auth=${authData.token}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pageData)
    });

    if (response.status === 401) {
      // Token might be expired (Firebase ID tokens expire after 1 hour).
      // Attempt silent re-authentication if credentials are saved.
      const saved = localStorage.getItem('spartenheim_auth_secure');
      if (saved) {
        showToast('🔄 Erneuere Verbindung...', 'info');
        const decoded = decodeURIComponent(escape(atob(saved)));
        const parsed = JSON.parse(decoded);
        
        let apiKey = 'AIzaSyAMH7xsRU0XxI7IVyI3iULUcfsIo6DNbpA';
        try {
          const configRes = await fetch('data.json');
          if (configRes.ok) {
            const config = await configRes.json();
            apiKey = config.firebase ? config.firebase.apiKey : apiKey;
          }
        } catch (e) {}

        let email = parsed.u;
        if (!email.includes('@')) {
          email = `${email.toLowerCase()}@naturfreundeschoenheide.de`;
        }

        const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: parsed.p,
            returnSecureToken: true
          })
        });

        if (authResponse.ok) {
          const authJson = await authResponse.json();
          authData.token = authJson.idToken;
          
          // Retry the write request with the new token
          response = await fetch(`${firebaseUrl}/data.json?auth=${authData.token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pageData)
          });
        }
      }
    }

    if (!response.ok) {
      throw new Error(`Datenbank-Fehler: ${response.statusText}`);
    }

    showToast('✅ Änderungen live gespeichert!', 'success');
    return true;
  } catch (error) {
    console.error(error);
    showToast(`❌ Fehler beim Speichern: ${error.message}`, 'error');
    return false;
  }
}

// Save Tab 1: General & Banner
async function saveGeneralData() {
  pageData.openStatus = document.getElementById('admin-status-toggle').checked;
  pageData.banner = {
    visible: document.getElementById('admin-banner-toggle').checked,
    text: document.getElementById('admin-banner-text').value.trim()
  };

  if (!pageData.contact) pageData.contact = {};
  pageData.contact.phone = document.getElementById('admin-contact-phone').value.trim();
  pageData.contact.email = document.getElementById('admin-contact-email').value.trim();
  pageData.contact.inhaber = document.getElementById('admin-contact-inhaber').value.trim();

  await commitDataChange('Admin Panel: Status und allgemeine Daten geändert');
}

// Save Tab 2: Opening Hours
async function saveHoursData() {
  if (!pageData.openingHours) return;

  pageData.openingHours.forEach((item, index) => {
    const input = document.getElementById(`hour-day-${index}`);
    if (input) {
      item.hours = input.value.trim();
    }
  });

  await commitDataChange('Admin Panel: Öffnungszeiten geändert');
}

// Save Tab 3: Calendar
async function saveCalendarData() {
  await commitDataChange('Admin Panel: Belegungsplan / Termine geändert');
}

async function addNewCalendarEntry() {
  const startInput = document.getElementById('new-event-start-date');
  const endInput = document.getElementById('new-event-end-date');
  const statusInput = document.getElementById('new-event-status');
  const labelInput = document.getElementById('new-event-label');

  if (!startInput.value || !labelInput.value.trim()) {
    alert('Bitte tragen Sie ein Startdatum und eine Beschreibung ein.');
    return;
  }

  const startDate = startInput.value;
  const endDate = endInput.value || startDate;

  if (new Date(endDate) < new Date(startDate)) {
    alert('Das Enddatum darf nicht vor dem Startdatum liegen.');
    return;
  }

  if (!pageData.planner) pageData.planner = [];

  const newEntry = {
    date: startDate,
    startDate: startDate,
    endDate: endDate,
    status: statusInput.value,
    label: labelInput.value.trim()
  };

  pageData.planner.push(newEntry);
  populateCalendarTab();
  
  // Clear inputs
  startInput.value = '';
  endInput.value = '';
  labelInput.value = '';

  await saveCalendarData();
}

async function deleteCalendarEntry(index) {
  // Sort planner to match populated index representation
  const sortedIndices = [...pageData.planner]
    .map((item, origIndex) => ({ item, origIndex }))
    .sort((a, b) => new Date(a.item.startDate || a.item.date) - new Date(b.item.startDate || b.item.date));

  const targetOrigIndex = sortedIndices[index].origIndex;
  
  pageData.planner.splice(targetOrigIndex, 1);
  populateCalendarTab();

  await saveCalendarData();
}

// Save Tab 4: Gallery Uploads
async function uploadGalleryImage() {
  const fileInput = document.getElementById('new-gallery-file');
  const altInput = document.getElementById('new-gallery-alt');

  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Bitte wählen Sie ein Bild zum Hochladen aus.');
    return;
  }

  const file = fileInput.files[0];
  const altText = altInput.value.trim() || 'Galeriebild';

  showToast('📤 Konvertiere und lade Bild...', 'info');

  try {
    const webpData = await convertToWebP(file);
    if (!pageData.gallery) pageData.gallery = [];
    pageData.gallery.push({
      src: webpData,
      alt: altText
    });

    const dataSaved = await commitDataChange('Admin Panel: Bild in Galerie hochgeladen');
    if (dataSaved) {
      populateGalleryTab();
      fileInput.value = '';
      altInput.value = '';
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ Upload-Fehler: ${err.message}`, 'error');
  }
}

async function deleteGalleryImage(index) {
  if (!confirm('Möchten Sie dieses Bild wirklich aus der Galerie entfernen?')) return;
  
  const targetImg = pageData.gallery[index];
  
  // Note: To delete the actual file in GitHub, we would need to fetch the file's SHA, then call DELETE.
  // To keep it robust and simple, we delete the reference in data.json. The file will remain in github but won't be loaded or visible on the website.
  pageData.gallery.splice(index, 1);
  populateGalleryTab();
  
  await commitDataChange('Admin Panel: Bild aus Galerie gelöscht');
}

// Save Tab 5: Guestbook Mod
async function saveReviewsData() {
  await commitDataChange('Admin Panel: Gästebuch Einträge moderiert');
}

async function toggleReviewApproval(index) {
  pageData.guestbook[index].approved = !pageData.guestbook[index].approved;
  populateGuestbookTab();
  await saveReviewsData();
}

async function deleteReview(index) {
  if (!confirm('Diesen Gästebucheintrag dauerhaft löschen?')) return;
  pageData.guestbook.splice(index, 1);
  populateGuestbookTab();
  await saveReviewsData();
}

async function addManualReview() {
  const nameInput = document.getElementById('admin-gb-name');
  const ratingInput = document.getElementById('admin-gb-rating');
  const commentInput = document.getElementById('admin-gb-comment');

  if (!nameInput.value.trim() || !commentInput.value.trim()) {
    alert('Bitte Name und Kommentar eintragen.');
    return;
  }

  if (!pageData.guestbook) pageData.guestbook = [];

  const newReview = {
    id: String(Date.now()),
    name: nameInput.value.trim(),
    rating: parseInt(ratingInput.value),
    comment: commentInput.value.trim(),
    date: new Date().toISOString().split('T')[0],
    approved: true
  };

  pageData.guestbook.push(newReview);
  populateGuestbookTab();

  // Clear inputs
  nameInput.value = '';
  commentInput.value = '';

  await saveReviewsData();
}

function populateSettingsTab() {
  const container = document.getElementById('hero-slides-admin');
  if (!container) return;

  container.innerHTML = '';
  const images = pageData.heroImages || [];

  for (let i = 0; i < 5; i++) {
    const imgData = images[i] || '';
    const slot = document.createElement('div');
    slot.className = 'hero-slot-row';
    slot.style.display = 'flex';
    slot.style.alignItems = 'center';
    slot.style.gap = '20px';
    slot.style.padding = '15px';
    slot.style.backgroundColor = 'var(--bg-cream)';
    slot.style.border = '1px solid var(--border)';
    slot.style.borderRadius = 'var(--radius-sm)';

    let previewHtml = '';
    if (imgData) {
      previewHtml = `
        <img src="${imgData}" style="width: 80px; height: 50px; object-fit: contain; border-radius: 4px; border: 1px solid var(--border); background: #eee;">
        <div style="flex-grow: 1;">
          <strong style="display:block; font-size: 0.95rem;">Bild Slot ${i + 1}</strong>
          <button class="admin-btn admin-btn-danger" style="padding: 4px 10px; font-size: 0.8rem; margin-top: 6px;" onclick="deleteHeroSlot(${i})">Entfernen</button>
        </div>
      `;
    } else {
      previewHtml = `
        <div style="width: 80px; height: 50px; background-color: #eee; border-radius: 4px; border: 1px dashed var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-muted);">Leer</div>
        <div style="flex-grow: 1;">
          <strong style="display:block; font-size: 0.95rem;">Bild Slot ${i + 1}</strong>
          <input type="file" id="hero-file-slot-${i}" accept="image/*" style="display:none;" onchange="uploadHeroSlot(event, ${i})">
          <button class="admin-btn admin-btn-primary" style="padding: 4px 10px; font-size: 0.8rem; margin-top: 6px;" onclick="document.getElementById('hero-file-slot-${i}').click()">Bild hochladen</button>
        </div>
      `;
    }
    slot.innerHTML = previewHtml;
    container.appendChild(slot);
  }
}

async function uploadHeroSlot(event, index) {
  const file = event.target.files[0];
  if (!file) return;

  showToast('📤 Konvertiere und lade Bild...', 'info');

  try {
    const webpData = await convertToWebP(file);
    
    if (!pageData.heroImages) pageData.heroImages = [];
    pageData.heroImages[index] = webpData;

    // Clean up trailing empty elements
    while (pageData.heroImages.length > 0 && !pageData.heroImages[pageData.heroImages.length - 1]) {
      pageData.heroImages.pop();
    }

    populateSettingsTab();
    await commitDataChange('Admin Panel: Startseite Slideshow aktualisiert');
  } catch (err) {
    console.error(err);
    showToast(`❌ Fehler beim Hochladen: ${err.message}`, 'error');
  }
}

async function deleteHeroSlot(index) {
  if (!confirm(`Möchten Sie das Bild aus Slot ${index + 1} entfernen?`)) return;

  if (pageData.heroImages) {
    pageData.heroImages[index] = '';
    // Clean up trailing empty elements
    while (pageData.heroImages.length > 0 && !pageData.heroImages[pageData.heroImages.length - 1]) {
      pageData.heroImages.pop();
    }
  }

  populateSettingsTab();
  await commitDataChange('Admin Panel: Bild aus Startseite Slideshow entfernt');
}

function convertToWebP(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const webpDataUrl = canvas.toDataURL('image/webp', quality);
        resolve(webpDataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------

// Show status notifications
function showToast(message, type = 'info') {
  const toast = document.getElementById('sync-toast');
  const text = document.getElementById('sync-toast-text');
  const icon = document.getElementById('sync-toast-icon');

  if (!toast) return;

  text.textContent = message;
  toast.className = `sync-toast ${type}`;
  
  if (type === 'success') icon.textContent = '✅';
  else if (type === 'error') icon.textContent = '❌';
  else icon.textContent = '🔄';

  toast.style.display = 'flex';
  
  // Auto hide success/error after 4 seconds
  if (type !== 'info') {
    setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);
  }
}

// Escape HTML utility
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
