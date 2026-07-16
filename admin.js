// ============================================
// CONFIGURATION – These are fixed for this site
// ============================================
const GITHUB_REPO = 'paulus-digital/naturfreundeschoenheide';
const GITHUB_BRANCH = 'main';

// Global Admin State
let authData = {
  token: '',
  isDemo: false
};

let pageData = {};
let currentFileSha = '';
let activeTab = 'general';

document.addEventListener('DOMContentLoaded', () => {
  checkSavedAuth();
  setupStatusToggle();
});

// Check if credentials exist in localStorage
function checkSavedAuth() {
  const saved = localStorage.getItem('spartenheim_auth');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      authData.token = parsed.token || '';
      authData.isDemo = parsed.isDemo || false;
      
      // Auto connect if token exists
      if (authData.token && !authData.isDemo) {
        connectToGitHub();
      } else if (authData.isDemo) {
        startDemoMode();
      }
    } catch (e) {
      localStorage.removeItem('spartenheim_auth');
    }
  }
}

// Login Handler – simplified: only password field
function handleLogin(event) {
  event.preventDefault();
  
  authData.token = document.getElementById('admin-password').value.trim();
  authData.isDemo = false;

  connectToGitHub();
}

// Connect to GitHub API
async function connectToGitHub() {
  showToast('🔄 Verbinde...', 'info');
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json?ref=${GITHUB_BRANCH}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${authData.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Ungültiger GitHub-Token (401 Unauthorized). Bitte prüfen Sie, ob der Token korrekt eingegeben wurde.');
      } else if (response.status === 403) {
        throw new Error('Zugriff verweigert (403 Forbidden). Ihr Token besitzt eventuell keine ausreichenden Rechte. Stellen Sie sicher, dass "repo" aktiviert ist.');
      } else if (response.status === 404) {
        throw new Error('Die Website-Daten (data.json) konnten nicht gefunden werden. Prüfen Sie den Repository-Namen.');
      } else {
        throw new Error(`Verbindungsfehler: ${response.statusText}`);
      }
    }

    const json = await response.json();
    currentFileSha = json.sha;
    
    // Decode base64 content
    const decodedContent = decodeURIComponent(escape(atob(json.content.replace(/\s/g, ''))));
    pageData = JSON.parse(decodedContent);

    // Save auth data if "remember me" is checked
    const rememberCheckbox = document.getElementById('remember-login');
    if (!rememberCheckbox || rememberCheckbox.checked) {
      localStorage.setItem('spartenheim_auth', JSON.stringify(authData));
    }
    
    // Show Dashboard
    showDashboard();
    showToast('✅ Erfolgreich angemeldet!', 'success');
  } catch (error) {
    console.error(error);
    errorEl.textContent = error.message;
    errorEl.style.display = 'block';
    showToast('❌ Anmeldung fehlgeschlagen', 'error');
  }
}

// Start Local Demo Mode
function startDemoMode() {
  authData.isDemo = true;
  localStorage.setItem('spartenheim_auth', JSON.stringify(authData));

  // Load from local storage or fallback to default
  const localBackup = localStorage.getItem('spartenheim_backup_data');
  if (localBackup) {
    pageData = JSON.parse(localBackup);
  } else {
    // Default placeholder data
    pageData = {
      openStatus: true,
      banner: {
        visible: true,
        text: "Willkommen im Spartenheim Naturfreunde! (Demo Modus aktiv)"
      },
      openingHours: [
        { day: "Montag", hours: "Ruhetag" },
        { day: "Dienstag", hours: "Ruhetag" },
        { day: "Mittwoch", hours: "16:00 - 22:00" },
        { day: "Donnerstag", hours: "16:00 - 22:00" },
        { day: "Freitag", hours: "15:00 - 23:00" },
        { day: "Samstag", hours: "12:00 - 23:00" },
        { day: "Sonntag", hours: "11:30 - 21:00" }
      ],
      planner: [
        { date: "2026-07-17", status: "event", label: "Schlachtfest & Musik ab 17:00 Uhr" }
      ],
      gallery: [],
      guestbook: [],
      contact: {
        name: "Gaststätte Spartenheim Naturfreunde",
        address: "Gartenweg, 08304 Schönheide",
        inhaber: "Ina Schultze",
        phone: "+49 (0) 37755 12345",
        email: "info@spartenheim-schoenheide.de",
        web3formsKey: "YOUR_WEB3FORMS_ACCESS_KEY_HERE"
      }
    };
  }

  showDashboard();
  showToast('ℹ️ Demo-Modus geladen', 'success');
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
  
  if (!toggle) return;
  
  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      label.textContent = 'Geöffnet';
      label.style.color = 'var(--success)';
    } else {
      label.textContent = 'Geschlossen';
      label.style.color = 'var(--danger)';
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
    document.getElementById('admin-contact-web3forms').value = pageData.contact.web3formsKey || '';
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

  // Sort by date
  const sorted = [...pageData.planner].sort((a, b) => new Date(a.date) - new Date(b.date));

  sorted.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'admin-item-row';
    
    // Status translation for badge
    const statusText = {
      'open': 'Offen', 'booked': 'Ausgebucht', 'closed': 'Geschlossen',
      'holiday': 'Urlaub', 'reservation': 'Reservierung möglich', 'event': 'Event'
    }[item.status] || item.status;

    const formattedDate = new Date(item.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    row.innerHTML = `
      <div class="admin-item-details">
        <span class="admin-item-date">${formattedDate}</span>
        <span class="admin-item-label">${item.label} (${statusText})</span>
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

// Commit entire pageData back to GitHub
async function commitDataChange(logMessage) {
  showToast('💾 Speichere Änderungen auf GitHub...', 'info');

  if (authData.isDemo) {
    // Demo mode: Write to local storage
    localStorage.setItem('spartenheim_backup_data', JSON.stringify(pageData, null, 2));
    showToast('✅ Lokal gespeichert (Demo-Modus)', 'success');
    return true;
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
    
    // UTF-8 safe base64 encoding
    const encodedContent = btoa(unescape(encodeURIComponent(JSON.stringify(pageData, null, 2))));
    
    const body = {
      message: logMessage || 'Website verwalten: Daten aktualisiert',
      content: encodedContent,
      sha: currentFileSha,
      branch: GITHUB_BRANCH
    };

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${authData.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`GitHub Save Error: ${response.statusText}`);
    }

    const result = await response.json();
    currentFileSha = result.content.sha; // Update SHA for consecutive saves
    showToast('✅ Erfolgreich im GitHub-Repo gespeichert!', 'success');
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
  pageData.contact.web3formsKey = document.getElementById('admin-contact-web3forms').value.trim();

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

function addNewCalendarEntry() {
  const dateInput = document.getElementById('new-event-date');
  const statusInput = document.getElementById('new-event-status');
  const labelInput = document.getElementById('new-event-label');

  if (!dateInput.value || !labelInput.value.trim()) {
    alert('Bitte tragen Sie ein Datum und eine Beschreibung ein.');
    return;
  }

  if (!pageData.planner) pageData.planner = [];

  const newEntry = {
    date: dateInput.value,
    status: statusInput.value,
    label: labelInput.value.trim()
  };

  pageData.planner.push(newEntry);
  populateCalendarTab();
  
  // Clear inputs
  dateInput.value = '';
  labelInput.value = '';
}

function deleteCalendarEntry(index) {
  // Sort planner to match populated index representation
  const sortedIndices = [...pageData.planner]
    .map((item, origIndex) => ({ item, origIndex }))
    .sort((a, b) => new Date(a.item.date) - new Date(b.item.date));

  const targetOrigIndex = sortedIndices[index].origIndex;
  
  pageData.planner.splice(targetOrigIndex, 1);
  populateCalendarTab();
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

  showToast('📤 Bereite Bild-Upload vor...', 'info');

  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = async () => {
    const base64Data = reader.result.split(',')[1];
    const fileExt = file.name.split('.').pop().toLowerCase();
    const fileName = `img_${Date.now()}.${fileExt}`;
    const filePath = `gallery/${fileName}`;

    if (authData.isDemo) {
      // Local storage mockup image path (save full dataUrl for demo viewing!)
      if (!pageData.gallery) pageData.gallery = [];
      pageData.gallery.push({
        src: reader.result,
        alt: altText
      });
      populateGalleryTab();
      await commitDataChange('Admin Panel (Demo): Bild lokal hinzugefügt');
      
      // Reset inputs
      fileInput.value = '';
      altInput.value = '';
      return;
    }

    try {
      // 1. Upload binary file to GitHub repo
      const uploadUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
      const body = {
        message: `Upload gallery image: ${fileName}`,
        content: base64Data,
        branch: GITHUB_BRANCH
      };

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${authData.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Fehler beim Hochladen der Bilddatei: ${response.statusText}`);
      }

      // 2. Add path to pageData and save data.json
      if (!pageData.gallery) pageData.gallery = [];
      pageData.gallery.push({
        src: filePath,
        alt: altText
      });

      const dataSaved = await commitDataChange(`Admin Panel: Galerie um Bild ${fileName} erweitert`);
      if (dataSaved) {
        populateGalleryTab();
        fileInput.value = '';
        altInput.value = '';
      }
    } catch (err) {
      console.error(err);
      showToast(`❌ Upload-Fehler: ${err.message}`, 'error');
    }
  };
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

function toggleReviewApproval(index) {
  pageData.guestbook[index].approved = !pageData.guestbook[index].approved;
  populateGuestbookTab();
}

function deleteReview(index) {
  if (!confirm('Diesen Gästebucheintrag dauerhaft löschen?')) return;
  pageData.guestbook.splice(index, 1);
  populateGuestbookTab();
}

function addManualReview() {
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
