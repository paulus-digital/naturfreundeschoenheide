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
  const saved = localStorage.getItem('naturfreunde_auth_secure');
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
      localStorage.removeItem('naturfreunde_auth_secure');
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
      localStorage.setItem('naturfreunde_auth_secure', creds);
    } else {
      localStorage.removeItem('naturfreunde_auth_secure');
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
    if (!pageData.specialHours) pageData.specialHours = [];
    
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
  localStorage.removeItem('naturfreunde_auth_secure');
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
  populateGalleryTab();
  populateGuestbookTab();
  populateSettingsTab();
}

// Switch Sidebar Tabs
function switchTab(tabId) {
  if (tabId === 'calendar') tabId = 'hours';
  activeTab = tabId;
  
  // Update Buttons
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = Array.from(document.querySelectorAll('.admin-tab-btn')).find(btn => 
    btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabId)
  );
  if (activeBtn) activeBtn.classList.add('active');

  // Update Sections
  document.querySelectorAll('.panel-section').forEach(sec => {
    sec.classList.remove('active');
  });
  const sec = document.getElementById(`panel-${tabId}`);
  if (sec) sec.classList.add('active');
}

// Setup Event Listeners for controls
function setupStatusToggle() {
  const toggle = document.getElementById('admin-status-toggle');
  
  if (toggle) {
    toggle.addEventListener('change', async () => {
      updateLiveStatusUI(toggle.checked);
      await commitDataChange(toggle.checked ? 'Live-Status auf Geöffnet geändert' : 'Live-Status auf Geschlossen geändert');
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
// ISO WEEK UTILITIES & STATE
// ----------------------------------------------------
let plannerSelectedMonday = getMonday(new Date());

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  return new Date(date.setDate(diff));
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function formatDateToYYYYMMDD(date) {
  const d = new Date(date);
  let month = '' + (d.getMonth() + 1);
  let day = '' + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}

// ----------------------------------------------------
// TAB FILLING LOGIC
// ----------------------------------------------------

function isDatePast(dateStr) {
  if (!dateStr) return false;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  // Set date to end of that day (23:59:59) so event is active all day on the date itself
  const eventDateEnd = new Date(year, month, day, 23, 59, 59, 999);
  const now = new Date();
  
  return eventDateEnd < now;
}

function setupStatusToggle() {
  const statusToggle = document.getElementById('admin-status-toggle');
  if (statusToggle) {
    statusToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const desired = !pageData.openStatus;
      toggleLiveStatus(desired);
    });
  }
}

async function toggleLiveStatus(desiredState) {
  let isTrue = desiredState;
  
  if (isTrue) {
    // Determine existing hours for today as default prompt value
    const todayStr = formatDateToYYYYMMDD(new Date());
    let defaultVal = '16:00 - 22:00 Uhr';
    
    if (pageData.specialHours) {
      const sp = pageData.specialHours.find(h => h.date === todayStr);
      if (sp && sp.hours && !sp.hours.toLowerCase().includes('geschlossen') && !sp.hours.toLowerCase().includes('ruhetag')) {
        defaultVal = sp.hours;
      }
    }

    const userInput = prompt('Bitte die heutige Öffnungszeit eingeben (z. B. 16:00 - 22:00 Uhr oder ab 17:00 Uhr):', defaultVal);
    
    if (userInput === null) {
      // User cancelled prompt -> keep current status
      updateLiveStatusUI(pageData.openStatus);
      return;
    }

    const hoursText = userInput.trim() || defaultVal;

    // Overwrite / create specialHours entry for TODAY only
    if (!pageData.specialHours) pageData.specialHours = [];
    const existingIndex = pageData.specialHours.findIndex(h => h.date === todayStr);
    
    const todayEntry = {
      date: todayStr,
      hours: hoursText,
      type: 'open',
      label: 'Heute geöffnet'
    };

    if (existingIndex !== -1) {
      pageData.specialHours[existingIndex] = todayEntry;
    } else {
      pageData.specialHours.push(todayEntry);
    }
  } else {
    // Switch to GESCHLOSSEN -> set today's special hours to Geschlossen
    const todayStr = formatDateToYYYYMMDD(new Date());
    if (!pageData.specialHours) pageData.specialHours = [];
    const existingIndex = pageData.specialHours.findIndex(h => h.date === todayStr);
    
    const todayEntry = {
      date: todayStr,
      hours: 'Geschlossen',
      type: 'closed',
      label: 'Heute geschlossen'
    };

    if (existingIndex !== -1) {
      pageData.specialHours[existingIndex] = todayEntry;
    } else {
      pageData.specialHours.push(todayEntry);
    }
  }

  pageData.openStatus = isTrue;
  updateLiveStatusUI(isTrue);
  
  showToast(isTrue ? '🟢 Live-Status: HEUTE GEÖFFNET' : '🔴 Live-Status: HEUTE GESCHLOSSEN', 'success');
  await commitDataChange(isTrue ? 'Live-Status auf Geöffnet geändert' : 'Live-Status auf Geschlossen geändert');
}

function updateLiveStatusUI(isOpen) {
  const isTrue = String(isOpen) === 'true' || isOpen === true;
  pageData.openStatus = isTrue;

  // 1. Slider Toggle Checkbox
  const statusToggle = document.getElementById('admin-status-toggle');
  if (statusToggle) {
    statusToggle.checked = isTrue;
  }

  // 2. Slider Label
  const label = document.getElementById('admin-status-label');
  if (label) {
    label.textContent = isTrue ? 'Geöffnet' : 'Geschlossen';
    label.style.color = isTrue ? 'var(--success)' : 'var(--danger)';
  }

  // 3. Quick Action Card Badge
  const quickBadge = document.getElementById('quick-status-badge');
  if (quickBadge) {
    quickBadge.textContent = isTrue ? 'GEÖFFNET' : 'GESCHLOSSEN';
    quickBadge.style.backgroundColor = isTrue ? '#2e7d32' : '#c62828';
  }

  // 4. Quick Action Card Icon
  const quickIcon = document.querySelector('.easy-quick-card .quick-card-icon');
  if (quickIcon) {
    quickIcon.textContent = isTrue ? '🟢' : '🔴';
  }

  // 5. Update Social Media Graphic Preview if canvas is rendered
  const canvas = document.getElementById('social-graphic-canvas');
  if (canvas) {
    updateSocialGraphic(false);
  }
}

function populateGeneralTab() {
  updateLiveStatusUI(pageData.openStatus);

  const bannerToggle = document.getElementById('admin-banner-toggle');
  if (bannerToggle) bannerToggle.checked = pageData.banner ? Boolean(pageData.banner.visible) : false;

  const bannerText = document.getElementById('admin-banner-text');
  if (bannerText) bannerText.value = pageData.banner ? pageData.banner.text : '';

  // Initialize Social Media Generator canvas & preview
  initSocialGenerator();
}

async function toggleQuickStatus() {
  const currentStatus = String(pageData.openStatus) === 'true' || pageData.openStatus === true;
  const desiredStatus = !currentStatus;
  await toggleLiveStatus(desiredStatus);
}

function scrollToSocialGen() {
  const el = document.querySelector('.social-gen-card');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function applySpecialPreset(presetType) {
  const dateInput = document.getElementById('new-special-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  const hoursRadio = document.getElementById('type-radio-hours');
  const closedRadio = document.getElementById('type-radio-closed');
  const eventRadio = document.getElementById('type-radio-event');
  const closedChk = document.getElementById('special-is-closed-chk');
  const eventChk = document.getElementById('special-is-event-chk');
  const startInput = document.getElementById('new-special-time-start');
  const endInput = document.getElementById('new-special-time-end');
  const labelInput = document.getElementById('new-special-label');

  if (presetType === 'closed') {
    if (closedRadio) closedRadio.checked = true;
    if (closedChk) closedChk.checked = true;
    if (eventChk) eventChk.checked = false;
    if (labelInput) labelInput.value = 'Geschlossen';
  } else if (presetType === 'regular') {
    if (hoursRadio) hoursRadio.checked = true;
    if (closedChk) closedChk.checked = false;
    if (eventChk) eventChk.checked = false;
    if (startInput) startInput.value = '11:30';
    if (endInput) endInput.value = '21:00';
    if (labelInput) labelInput.value = 'Regulär geöffnet';
  } else if (presetType === 'event') {
    if (eventRadio) eventRadio.checked = true;
    if (closedChk) closedChk.checked = false;
    if (eventChk) eventChk.checked = true;
    if (startInput) startInput.value = '11:30';
    if (endInput) endInput.value = '21:00';
    if (labelInput) labelInput.value = 'Sonder-Event / Feier';
  } else if (presetType === 'holiday') {
    if (closedRadio) closedRadio.checked = true;
    if (closedChk) closedChk.checked = true;
    if (eventChk) eventChk.checked = false;
    if (labelInput) labelInput.value = 'Betriebsferien / Urlaub';
  }

  handleSpecialTypeChange();
  showToast('⚡ Vorlage übernommen! Prüfe das Datum und klicke auf Speichern.', 'info');
}

// ----------------------------------------------------
// SOCIAL MEDIA GRAPHIC & SHARE TEXT GENERATOR LOGIC
// ----------------------------------------------------
function initSocialGenerator() {
  const dateInput = document.getElementById('social-gen-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Populate hero images dropdown options
  const bgSelect = document.getElementById('social-gen-bg');
  if (bgSelect) {
    bgSelect.innerHTML = `
      <option value="default">Standard (Gaststätte &amp; Naturfreunde)</option>
      <option value="logo">Naturfreunde Wappen &amp; Logo</option>
    `;
    if (pageData.heroImages && pageData.heroImages.length > 0) {
      pageData.heroImages.forEach((imgSrc, idx) => {
        if (imgSrc) {
          const opt = document.createElement('option');
          opt.value = imgSrc;
          opt.textContent = `Slideshow Bild ${idx + 1}`;
          bgSelect.appendChild(opt);
        }
      });
    }
  }

  updateSocialGraphic(false);
}

function getOpeningInfoForDate(dateStr) {
  if (!dateStr) dateStr = new Date().toISOString().split('T')[0];
  
  // 1. Check special hours
  if (pageData.specialHours) {
    const special = pageData.specialHours.find(h => h.date === dateStr);
    if (special) {
      return {
        hours: special.hours,
        label: special.label || '',
        type: 'special'
      };
    }
  }

  // 2. Check planner
  if (pageData.planner) {
    const event = pageData.planner.find(p => {
      const s = p.startDate || p.date;
      const e = p.endDate || p.startDate || p.date;
      return dateStr >= s && dateStr <= e;
    });
    if (event) {
      const statusNames = {
        'open': 'Geöffnet',
        'reservation': 'Reservierung möglich',
        'booked': 'Ausgebucht',
        'closed': 'Geschlossen',
        'holiday': 'Betriebsferien / Urlaub',
        'event': 'Besonderes Event'
      };
      return {
        hours: event.label || statusNames[event.status] || 'Geändert',
        label: statusNames[event.status] || '',
        type: 'planner'
      };
    }
  }

  // 3. Fallback: regular day of week
  const dateParts = dateStr.split('-');
  if (dateParts.length === 3) {
    const d = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10));
    const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const germanDay = dayNames[d.getDay()];

    if (pageData.openingHours) {
      const match = pageData.openingHours.find(h => h.day.toLowerCase() === germanDay.toLowerCase());
      if (match) {
        return {
          hours: match.hours,
          label: '',
          type: 'regular'
        };
      }
    }
  }

  return { hours: '11:30 - 21:00 Uhr', label: '', type: 'default' };
}

function updateSocialGraphic(isUserOverride = false) {
  const dateInput = document.getElementById('social-gen-date');
  const bgSelect = document.getElementById('social-gen-bg');
  const statusInput = document.getElementById('social-gen-status-text');
  const canvas = document.getElementById('social-graphic-canvas');
  if (!canvas) return;

  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
  const info = getOpeningInfoForDate(dateStr);

  if (!isUserOverride && statusInput) {
    let autoText = '';
    const hLower = (info.hours || '').toLowerCase();
    if (hLower.includes('ruhetag') || hLower.includes('geschlossen')) {
      autoText = info.label ? `Geschlossen: ${info.label}` : `Geschlossen`;
    } else {
      autoText = info.label ? `Öffnungszeit: ${info.hours} (${info.label})` : `Öffnungszeit: ${info.hours}`;
    }
    statusInput.value = autoText;
  }

  const displayText = statusInput ? statusInput.value.trim() : `Öffnungszeit: ${info.hours}`;

  // Formatted German Date
  let formattedDate = dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    formattedDate = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Background Image selection
  let bgSource = pageData.socialDefaultBg || 'hero_cabin.png';
  const selectedBg = bgSelect ? bgSelect.value : 'default';
  if (selectedBg === 'logo') {
    bgSource = 'logo.png';
  } else if (selectedBg !== 'default' && selectedBg) {
    bgSource = selectedBg;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = bgSource;

  const renderCanvas = () => {
    // 1. Draw Background Image
    if (img.complete && img.naturalWidth > 0) {
      const imgAspect = img.naturalWidth / img.naturalHeight;
      let drawWidth = width;
      let drawHeight = width / imgAspect;
      if (drawHeight < height) {
        drawHeight = height;
        drawWidth = height * imgAspect;
      }
      ctx.drawImage(img, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#1c3a19');
      grad.addColorStop(1, '#0e1f0c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

// 2. Light overlay for subtle contrast
    const overlayGrad = ctx.createLinearGradient(0, 0, 0, height);
    overlayGrad.addColorStop(0, 'rgba(15, 30, 15, 0.40)');
    overlayGrad.addColorStop(1, 'rgba(5, 10, 5, 0.60)');
    ctx.fillStyle = overlayGrad;
    ctx.fillRect(0, 0, width, height);

    // 3. Header / Branding Logo (draw the high-quality logo.png directly)
    const logoImg = new Image();
    logoImg.src = 'logo.png';
    const drawContent = () => {
      let logoHeight = 240;
      if (logoImg.complete && logoImg.naturalWidth > 0) {
        const logoWidth = 600;
        logoHeight = logoImg.naturalHeight * (logoWidth / logoImg.naturalWidth);
        ctx.drawImage(logoImg, (width - logoWidth) / 2, 120, logoWidth, logoHeight);
      }

      // Title & Subtitle are fully represented in the image logo, so we skip text drawing

      // Divider Line
      ctx.strokeStyle = '#c59f2d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const dividerY = 120 + logoHeight + 25;
      ctx.moveTo(width / 2 - 150, dividerY);
      ctx.lineTo(width / 2 + 150, dividerY);
      ctx.stroke();

      // Date Badge
      ctx.textAlign = 'center';
      ctx.fillStyle = '#faf6ef';
      ctx.font = '500 38px sans-serif';
      const dateY = dividerY + 65;
      ctx.fillText(formattedDate, width / 2, dateY);

      // Main Status Card Box (Beautiful rounded soft card instead of warn warning block)
      const isClosed = displayText.toLowerCase().includes('geschlossen') || displayText.toLowerCase().includes('ruhetag');
      const boxBg = isClosed ? 'rgba(128, 32, 32, 0.9)' : 'rgba(32, 80, 37, 0.9)';
      const boxBorder = isClosed ? '#ef5350' : '#c59f2d';

      const boxY = dateY + 45;
      const boxHeight = 200;
      const boxWidth = 760;
      ctx.fillStyle = boxBg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect((width - boxWidth) / 2, boxY, boxWidth, boxHeight, 28);
        ctx.fill();
        ctx.strokeStyle = boxBorder;
        ctx.lineWidth = 4;
        ctx.stroke();
      } else {
        ctx.fillRect((width - boxWidth) / 2, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = boxBorder;
        ctx.lineWidth = 4;
        ctx.strokeRect((width - boxWidth) / 2, boxY, boxWidth, boxHeight);
      }

      // Status Text Inside Box
      const maxTextWidth = boxWidth - 100; // 660px max
      ctx.fillStyle = '#ffffff';
      const textCenterY = boxY + boxHeight / 2;

      if (displayText.includes('(') && displayText.includes(')')) {
        const mainPart = displayText.substring(0, displayText.indexOf('(')).trim();
        const subPart = displayText.substring(displayText.indexOf('(')).trim();

        let fSize1 = 54;
        ctx.font = `bold ${fSize1}px sans-serif`;
        while (ctx.measureText(mainPart).width > maxTextWidth && fSize1 > 28) {
          fSize1 -= 2;
          ctx.font = `bold ${fSize1}px sans-serif`;
        }
        ctx.fillText(mainPart, width / 2, textCenterY - 18);

        let fSize2 = 38;
        ctx.font = `600 ${fSize2}px sans-serif`;
        while (ctx.measureText(subPart).width > maxTextWidth && fSize2 > 24) {
          fSize2 -= 2;
          ctx.font = `600 ${fSize2}px sans-serif`;
        }
        ctx.fillStyle = '#e8dcc8';
        ctx.fillText(subPart, width / 2, textCenterY + 40);
      } else {
        let fSize = 54;
        ctx.font = `bold ${fSize}px sans-serif`;
        while (ctx.measureText(displayText).width > maxTextWidth && fSize > 28) {
          fSize -= 2;
          ctx.font = `bold ${fSize}px sans-serif`;
        }
        ctx.fillText(displayText, width / 2, textCenterY + 18);
      }

      // Footer Info (calculated dynamically relative to the box bottom)
      const correctAddress = (pageData.contact && pageData.contact.address) ? pageData.contact.address : 'Gartenweg 5, 08304 Schönheide';
      const addressY = boxY + boxHeight + 75;
      ctx.fillStyle = '#d0c8b5';
      ctx.font = '400 32px sans-serif';
      ctx.fillText(correctAddress, width / 2, addressY);

      const websiteY = addressY + 50;
      ctx.fillStyle = '#c59f2d';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('gaststätte-naturfreunde.de', width / 2, websiteY);

      // Update Download Link & Share Text
      const downloadBtn = document.getElementById('social-gen-download');
      if (downloadBtn) {
        downloadBtn.href = canvas.toDataURL('image/png');
      }

      let siteUrl = window.location.origin;
      siteUrl = siteUrl.replace(/xn--gaststtte-naturfreunde-54b\.de/gi, 'gaststätte-naturfreunde.de');
      siteUrl = siteUrl.replace(/paulus-digital\.github\.io\/naturfreundeschoenheide/gi, 'gaststätte-naturfreunde.de');
      if (siteUrl.includes('localhost') || siteUrl.includes('127.0.0.1')) {
        siteUrl = 'https://gaststätte-naturfreunde.de';
      }
      const textVal = `🌲 Gaststätte Naturfreunde Schönheide 🌲\n\n📅 ${formattedDate}:\n${displayText}\n\n📍 ${correctAddress}\n🌐 Öffnungszeiten & Termine: ${siteUrl}/`;
      const textArea = document.getElementById('social-gen-text');
      if (textArea) {
        textArea.value = textVal;
        // Dynamically auto-resize height to display all text cleanly without scrollbars
        textArea.style.height = 'auto';
        textArea.style.height = (textArea.scrollHeight + 8) + 'px';
      }

      const waBtn = document.getElementById('social-gen-wa-link');
      if (waBtn) {
        waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(textVal)}`;
      }
    };

    if (logoImg.complete) {
      drawContent();
    } else {
      logoImg.onload = drawContent;
      logoImg.onerror = drawContent;
    }
  };

  if (img.complete) {
    renderCanvas();
  } else {
    img.onload = renderCanvas;
    img.onerror = renderCanvas;
  }
}

function copySocialGenText() {
  const textArea = document.getElementById('social-gen-text');
  if (!textArea || !textArea.value) return;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(textArea.value).then(() => {
      showToast('✅ Text in Zwischenablage kopiert!', 'success');
    });
  } else {
    textArea.select();
    document.execCommand('copy');
    showToast('✅ Text in Zwischenablage kopiert!', 'success');
  }
}

function navigateWeek(offset) {
  plannerSelectedMonday.setDate(plannerSelectedMonday.getDate() + offset * 7);
  renderWeekPlanner();
}

function renderWeekPlanner() {
  const titleEl = document.getElementById('week-planner-title');
  const container = document.getElementById('admin-week-planner-fields');
  if (!container) return;

  const monday = new Date(plannerSelectedMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const kwNum = getWeekNumber(monday);
  const mondayFormatted = monday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const sundayFormatted = sunday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  if (titleEl) {
    titleEl.textContent = `Kalenderwoche ${kwNum} (${mondayFormatted} - ${sundayFormatted})`;
  }

  container.innerHTML = '';

  const GERMAN_WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + i);
    const dateStr = formatDateToYYYYMMDD(dayDate);
    const dateLabel = dayDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    // Look for specialHours exception
    const specialMatch = pageData.specialHours ? pageData.specialHours.find(h => h.date === dateStr) : null;

    // Standard hours template for this weekday
    const weekdayName = GERMAN_WEEKDAYS[i];
    const defaultItem = pageData.openingHours ? pageData.openingHours.find(h => h.day.toLowerCase() === weekdayName.toLowerCase()) : null;
    const defaultHours = defaultItem ? defaultItem.hours : 'Geschlossen';

    let hoursVal = defaultHours;
    let selectedType = 'standard';
    let labelVal = '';

    if (specialMatch) {
      hoursVal = specialMatch.hours;
      selectedType = (specialMatch.type === 'free') ? 'open' : (specialMatch.type || 'custom');
      labelVal = specialMatch.label || '';
    }

    const row = document.createElement('div');
    row.className = 'week-day-row';

    const statusBadgeStyle = specialMatch 
      ? 'background: rgba(217, 83, 79, 0.1); color: #d9534f; border: 1px solid rgba(217,83,79,0.25);'
      : 'background: rgba(92, 184, 92, 0.1); color: #5cb85c; border: 1px solid rgba(92,184,92,0.25);';

    const statusBadgeText = specialMatch ? 'Manuelle Ausnahme' : 'Grundeinstellung';

    row.innerHTML = `
      <div class="week-day-row-title">
        <strong style="font-size: 0.95rem; color: var(--primary-dark);">${weekdayName}, ${dateLabel}</strong>
        <span class="special-hours-badge-inline" style="font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; ${statusBadgeStyle}">${statusBadgeText}</span>
      </div>
      
      <div class="week-day-row-controls">
        <div class="week-day-col">
          <select id="week-day-type-${i}" class="form-control week-day-select" onchange="handleWeekDayTypeChange(${i})">
            <option value="standard" ${selectedType === 'standard' ? 'selected' : ''}>⚙️ Standard</option>
            <option value="open" ${selectedType === 'open' ? 'selected' : ''}>🟢 Geöffnet</option>
            <option value="closed" ${selectedType === 'closed' ? 'selected' : ''}>🔴 Geschlossen</option>
            <option value="event" ${selectedType === 'event' ? 'selected' : ''}>🎉 Sonder-Event</option>
            <option value="holiday" ${selectedType === 'holiday' ? 'selected' : ''}>🏖️ Urlaub / Ferien</option>
            <option value="booked" ${selectedType === 'booked' ? 'selected' : ''}>❌ Ausgebucht</option>
            <option value="custom" ${selectedType === 'custom' ? 'selected' : ''}>✍️ Manuell</option>
          </select>
        </div>
        <div class="week-day-col">
          <input type="text" id="week-day-hours-${i}" class="form-control week-day-input" value="${hoursVal}" placeholder="z.B. 17:00 - 22:00 Uhr">
        </div>
      </div>

      <div class="week-day-row-extra">
        <input type="text" id="week-day-label-${i}" class="form-control week-day-input" value="${labelVal}" placeholder="Zusatzinfo (z.B. Feiertag)" style="display: ${selectedType === 'standard' || selectedType === 'open' ? 'none' : 'block'};">
      </div>
    `;

    container.appendChild(row);
  }
}

function handleWeekDayTypeChange(index) {
  const select = document.getElementById(`week-day-type-${index}`);
  const labelInput = document.getElementById(`week-day-label-${index}`);
  const labelHeading = document.getElementById(`week-day-label-heading-${index}`);
  const hoursInput = document.getElementById(`week-day-hours-${index}`);
  
  if (!select || !labelInput || !hoursInput) return;

  const type = select.value;

  if (type === 'standard') {
    labelInput.style.display = 'none';
    if (labelHeading) labelHeading.style.display = 'none';
    const GERMAN_WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
    const weekdayName = GERMAN_WEEKDAYS[index];
    const defaultItem = pageData.openingHours ? pageData.openingHours.find(h => h.day.toLowerCase() === weekdayName.toLowerCase()) : null;
    hoursInput.value = defaultItem ? defaultItem.hours : 'Geschlossen';
  } else if (type === 'open') {
    labelInput.style.display = 'none';
    if (labelHeading) labelHeading.style.display = 'none';
    const hLower = (hoursInput.value || '').toLowerCase();
    if (!hoursInput.value || hLower.includes('geschlossen') || hLower.includes('ruhetag')) {
      hoursInput.value = '17:00 - 22:00 Uhr';
    }
  } else {
    labelInput.style.display = 'block';
    if (labelHeading) labelHeading.style.display = 'block';
    
    if (type === 'closed') {
      hoursInput.value = 'Geschlossen';
      if (!labelInput.value) labelInput.value = 'Geschlossen';
    } else if (type === 'holiday') {
      hoursInput.value = 'Geschlossen';
      if (!labelInput.value) labelInput.value = 'Betriebsferien';

      setTimeout(() => {
        const createRange = confirm('Möchten Sie Urlaub / Betriebsferien für einen längeren Zeitraum eintragen (z. B. mehrere Wochen)?\n\n[OK] = Ja, zum Zeitraum-Formular unten springen\n[Abbrechen] = Nein, nur für diesen einzelnen Tag');
        if (createRange) {
          const typeSelect = document.getElementById('new-special-type');
          if (typeSelect) {
            typeSelect.value = 'urlaub';
            if (typeof handleSpecialTypeSelectChange === 'function') {
              handleSpecialTypeSelectChange();
            }
          }
          const formAnchor = document.getElementById('new-special-type');
          if (formAnchor) {
            formAnchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          const dateInput = document.getElementById('new-special-date');
          if (dateInput) {
            dateInput.focus();
          }
        }
      }, 150);
    } else if (type === 'booked') {
      hoursInput.value = 'Geschlossen';
      if (!labelInput.value) labelInput.value = 'Ausgebucht';
    } else if (type === 'event') {
      if (!labelInput.value) labelInput.value = 'Event';
    }
  }
}

async function saveWeekPlanner() {
  if (!pageData.specialHours) pageData.specialHours = [];

  const monday = new Date(plannerSelectedMonday);
  const GERMAN_WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + i);
    const dateStr = formatDateToYYYYMMDD(dayDate);

    const typeSelect = document.getElementById(`week-day-type-${i}`);
    const hoursInput = document.getElementById(`week-day-hours-${i}`);
    const labelInput = document.getElementById(`week-day-label-${i}`);

    if (!typeSelect || !hoursInput || !labelInput) continue;

    const selectedType = typeSelect.value;
    const hoursVal = hoursInput.value.trim();
    const labelVal = labelInput.value.trim();

    const weekdayName = GERMAN_WEEKDAYS[i];
    const defaultItem = pageData.openingHours ? pageData.openingHours.find(h => h.day.toLowerCase() === weekdayName.toLowerCase()) : null;
    const defaultHours = defaultItem ? defaultItem.hours : 'Geschlossen';

    const existingIndex = pageData.specialHours.findIndex(h => h.date === dateStr);

    if (selectedType === 'standard' && hoursVal === defaultHours) {
      if (existingIndex !== -1) {
        pageData.specialHours.splice(existingIndex, 1);
      }
    } else {
      const entry = {
        date: dateStr,
        hours: hoursVal,
        type: selectedType === 'standard' ? 'custom' : selectedType,
        label: labelVal
      };

      if (existingIndex !== -1) {
        pageData.specialHours[existingIndex] = entry;
      } else {
        pageData.specialHours.push(entry);
      }
    }
  }

  showToast('💾 Speichere Wochen-Öffnungszeiten...', 'info');
  const dataSaved = await commitDataChange('Wochen-Planer: Öffnungszeiten geändert');
  if (dataSaved) {
    showToast('✅ Wochen-Öffnungszeiten erfolgreich gespeichert!', 'success');
    populateHoursTab();
  }
}

function populateHoursTab() {
  // Render weekly planner sheet
  renderWeekPlanner();

  // 2. Special/Deviating hours list (filter out past dates)
  const specialList = document.getElementById('admin-special-hours-list');
  if (specialList) {
    specialList.innerHTML = '';

    if (!pageData.specialHours) pageData.specialHours = [];

    // Automatically remove past special hours so stored list does not grow infinitely
    pageData.specialHours = pageData.specialHours.filter(item => !isDatePast(item.date));

    if (pageData.specialHours.length === 0) {
      specialList.innerHTML = '<p class="text-muted" style="padding: 15px;">Keine anstehenden Termine oder Ausnahmen geplant.</p>';
      return;
    }

    pageData.specialHours.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'admin-item-row';

      const dateParts = item.date ? item.date.split('-') : [];
      let dateStr = item.date;
      if (dateParts.length === 3) {
        const d = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        dateStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }

      const isClosed = item.hours && (item.hours.toLowerCase().includes('ruhetag') || item.hours.toLowerCase().includes('geschlossen'));
      const badgeStyle = isClosed 
        ? 'background: rgba(217, 83, 79, 0.15); color: #d9534f; border: 1px solid rgba(217,83,79,0.3);' 
        : 'background: rgba(197, 159, 45, 0.15); color: var(--primary-dark); border: 1px solid rgba(197, 159, 45, 0.3);';

      row.innerHTML = `
        <div class="admin-item-details">
          <span class="admin-item-date" style="font-size:0.9rem; font-weight:700; white-space: nowrap;">${dateStr}</span>
          <span class="admin-item-label">
            <strong>${escapeHTML(item.hours)}</strong>
            ${item.label ? `<span class="special-hours-badge-inline" style="margin-left: 6px; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; ${badgeStyle}">${escapeHTML(item.label)}</span>` : ''}
          </span>
        </div>
        <button class="admin-btn admin-btn-danger" style="padding: 6px 12px; font-size: 0.85rem; flex-shrink: 0;" onclick="deleteSpecialHours(${index})">Löschen</button>
      `;
      specialList.appendChild(row);
    });
  }
}

function populateCalendarTab() {
  const list = document.getElementById('admin-calendar-list');
  if (!list) return;

  list.innerHTML = '';
  
  if (!pageData.planner) pageData.planner = [];

  // Filter out past entries so list stays clean
  pageData.planner = pageData.planner.filter(item => {
    const endStr = item.endDate || item.startDate || item.date;
    return !isDatePast(endStr);
  });

  if (pageData.planner.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding: 15px;">Keine anstehenden Termine vorhanden.</p>';
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
      const saved = localStorage.getItem('naturfreunde_auth_secure');
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
  const statusToggle = document.getElementById('admin-status-toggle');
  if (statusToggle) {
    updateLiveStatusUI(statusToggle.checked);
  }
  
  const bannerToggle = document.getElementById('admin-banner-toggle');
  const bannerText = document.getElementById('admin-banner-text');
  pageData.banner = {
    visible: bannerToggle ? bannerToggle.checked : false,
    text: bannerText ? bannerText.value.trim() : ''
  };

  if (!pageData.contact) pageData.contact = {};
  const phoneEl = document.getElementById('admin-contact-phone');
  const emailEl = document.getElementById('admin-contact-email');
  const inhaberEl = document.getElementById('admin-contact-inhaber');
  if (phoneEl) pageData.contact.phone = phoneEl.value.trim();
  if (emailEl) pageData.contact.email = emailEl.value.trim();
  if (inhaberEl) pageData.contact.inhaber = inhaberEl.value.trim();

  await commitDataChange('Admin Panel: Status und allgemeine Daten geändert');
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
  const templateContainer = document.getElementById('admin-template-hours-fields');
  if (templateContainer && pageData.openingHours) {
    templateContainer.innerHTML = '';
    pageData.openingHours.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'form-group';
      row.style.marginBottom = '12px';
      row.innerHTML = `
        <label style="font-weight: 600;">${item.day}</label>
        <input type="text" id="template-hour-day-${index}" class="form-control" value="${item.hours}">
      `;
      templateContainer.appendChild(row);
    });
  }

  if (pageData.contact) {
    const phoneEl = document.getElementById('admin-contact-phone');
    const emailEl = document.getElementById('admin-contact-email');
    const inhaberEl = document.getElementById('admin-contact-inhaber');
    if (phoneEl) phoneEl.value = pageData.contact.phone || '';
    if (emailEl) emailEl.value = pageData.contact.email || '';
    if (inhaberEl) inhaberEl.value = pageData.contact.inhaber || '';
  }

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

  // Social Media Generator default background slot
  const socialBgContainer = document.getElementById('social-default-bg-admin');
  if (socialBgContainer) {
    const currentBg = pageData.socialDefaultBg || '';
    if (currentBg) {
      socialBgContainer.innerHTML = `
        <img src="${currentBg}" style="width: 100px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border); background: #eee;">
        <div style="flex-grow: 1;">
          <strong style="display:block; font-size: 0.95rem;">Aktuelles Standard-Hintergrundbild</strong>
          <div style="display:flex; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
            <input type="file" id="social-bg-file-input" accept="image/*" style="display:none;" onchange="uploadSocialDefaultBg(event)">
            <button class="admin-btn admin-btn-primary" style="padding: 6px 12px; font-size: 0.85rem;" onclick="document.getElementById('social-bg-file-input').click()">Ändern</button>
            <button class="admin-btn admin-btn-danger" style="padding: 6px 12px; font-size: 0.85rem;" onclick="deleteSocialDefaultBg()">Zurücksetzen (Standard)</button>
          </div>
        </div>
      `;
    } else {
      socialBgContainer.innerHTML = `
        <div style="width: 100px; height: 60px; background-color: #eee; border-radius: 4px; border: 1px dashed var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-muted); text-align: center; padding: 4px;">Original (hero_cabin)</div>
        <div style="flex-grow: 1;">
          <strong style="display:block; font-size: 0.95rem;">Standard-Bild festlegen</strong>
          <input type="file" id="social-bg-file-input" accept="image/*" style="display:none;" onchange="uploadSocialDefaultBg(event)">
          <button class="admin-btn admin-btn-primary" style="padding: 6px 12px; font-size: 0.85rem; margin-top: 6px;" onclick="document.getElementById('social-bg-file-input').click()">📷 Eigenes Standard-Bild hochladen</button>
        </div>
      `;
    }
  }
}

async function uploadSocialDefaultBg(event) {
  const file = event.target.files[0];
  if (!file) return;

  showToast('📤 Konvertiere und lade Bild...', 'info');

  try {
    const webpData = await convertToWebP(file, 1200, 0.85);
    pageData.socialDefaultBg = webpData;

    populateSettingsTab();
    if (typeof updateSocialGraphic === 'function') {
      updateSocialGraphic(false);
    }
    await commitDataChange('Admin Panel: Standard-Hintergrund für WhatsApp-Generator geändert');
  } catch (err) {
    console.error(err);
    showToast(`❌ Fehler beim Hochladen: ${err.message}`, 'error');
  }
}

async function deleteSocialDefaultBg() {
  if (!confirm('Möchten Sie das eigene Standard-Hintergrundbild zurücksetzen?')) return;

  delete pageData.socialDefaultBg;
  populateSettingsTab();
  if (typeof updateSocialGraphic === 'function') {
    updateSocialGraphic(false);
  }
  await commitDataChange('Admin Panel: Standard-Hintergrund auf Werkseinstellung zurückgesetzt');
}

async function saveTemplateHours() {
  if (!pageData.openingHours) return;

  pageData.openingHours.forEach((item, index) => {
    const input = document.getElementById(`template-hour-day-${index}`);
    if (input) {
      item.hours = input.value.trim();
    }
  });

  showToast('💾 Speichere Standard-Zeiten...', 'info');
  const dataSaved = await commitDataChange('Admin Panel: Grundeinstellungen Standard-Öffnungszeiten geändert');
  if (dataSaved) {
    showToast('✅ Standard-Öffnungszeiten erfolgreich gespeichert!', 'success');
    populateSettingsTab();
    renderWeekPlanner();
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

// Special hours type switcher handler
function handleSpecialTypeSelectChange() {
  const typeSelect = document.getElementById('new-special-type');
  const type = typeSelect ? typeSelect.value : 'closed';
  
  const timePickerGroup = document.getElementById('special-time-picker-group');
  const customTextGroup = document.getElementById('special-custom-text-group');
  const labelInput = document.getElementById('new-special-label');

  if (type === 'hours') {
    if (timePickerGroup) timePickerGroup.style.display = 'block';
    if (customTextGroup) customTextGroup.style.display = 'none';
    if (labelInput && !labelInput.value) labelInput.placeholder = 'z.B. Sonderöffnung';
  } else if (type === 'event') {
    if (timePickerGroup) timePickerGroup.style.display = 'block';
    if (customTextGroup) customTextGroup.style.display = 'none';
    if (labelInput && !labelInput.value) labelInput.placeholder = 'z.B. Schlachtfest, Live-Musik, Tanzabend';
  } else if (type === 'custom') {
    if (timePickerGroup) timePickerGroup.style.display = 'none';
    if (customTextGroup) customTextGroup.style.display = 'block';
    if (labelInput && !labelInput.value) labelInput.placeholder = 'z.B. Sonderregelung';
  } else if (type === 'urlaub') {
    if (timePickerGroup) timePickerGroup.style.display = 'none';
    if (customTextGroup) customTextGroup.style.display = 'none';
    if (labelInput && !labelInput.value) labelInput.placeholder = 'z.B. Betriebsferien, Sommerurlaub';
  } else {
    // closed
    if (timePickerGroup) timePickerGroup.style.display = 'none';
    if (customTextGroup) customTextGroup.style.display = 'none';
    if (labelInput && !labelInput.value) labelInput.placeholder = 'z.B. Ruhetag, Geschlossen';
  }
}

// Special hours additions & deletions
async function addNewSpecialHours() {
  const dateInput = document.getElementById('new-special-date');
  const dateEndInput = document.getElementById('new-special-date-end');
  const labelInput = document.getElementById('new-special-label');
  const typeSelect = document.getElementById('new-special-type');
  const selectedType = typeSelect ? typeSelect.value : 'closed';

  if (!dateInput || !dateInput.value) {
    alert('Bitte wähle ein Startdatum aus.');
    return;
  }

  const startDateStr = dateInput.value;
  const endDateStr = dateEndInput ? dateEndInput.value : '';

  if (endDateStr && new Date(endDateStr) < new Date(startDateStr)) {
    alert('Das Bis-Datum darf nicht vor dem Von-Datum liegen.');
    return;
  }

  let finalHours = '';
  let defaultLabel = '';

  if (selectedType === 'closed') {
    finalHours = 'Geschlossen';
    defaultLabel = 'Geschlossen';
  } else if (selectedType === 'urlaub') {
    finalHours = 'Betriebsferien / Urlaub';
    defaultLabel = 'Urlaub / Betriebsferien';
  } else if (selectedType === 'custom') {
    const customVal = document.getElementById('new-special-hours-custom')?.value.trim();
    if (!customVal) {
      alert('Bitte gib den abweichenden Text / Info ein.');
      return;
    }
    finalHours = customVal;
    defaultLabel = 'Sonderregelung';
  } else {
    // hours or event mode
    const startTime = document.getElementById('new-special-time-start')?.value;
    const endTime = document.getElementById('new-special-time-end')?.value;

    if (startTime && endTime) {
      finalHours = `${startTime} - ${endTime} Uhr`;
    } else if (startTime) {
      finalHours = `ab ${startTime} Uhr`;
    } else {
      finalHours = selectedType === 'event' ? 'Event-Tag' : 'Geöffnet';
    }
    defaultLabel = selectedType === 'event' ? 'Event / Veranstaltung' : 'Sonder-Öffnungszeit';
  }

  let finalLabel = labelInput ? labelInput.value.trim() : '';
  if (!finalLabel) {
    finalLabel = defaultLabel;
  }

  if (!pageData.specialHours) pageData.specialHours = [];

  if (endDateStr && endDateStr > startDateStr) {
    // Range selected (e.g. Betriebsferien / Urlaub vom 01.08. bis 14.08.)
    const curr = new Date(startDateStr);
    const stop = new Date(endDateStr);
    while (curr <= stop) {
      const formattedCurr = curr.toISOString().split('T')[0];
      const existingIdx = pageData.specialHours.findIndex(h => h.date === formattedCurr);
      if (existingIdx !== -1) {
        pageData.specialHours.splice(existingIdx, 1);
      }
      pageData.specialHours.push({
        date: formattedCurr,
        hours: finalHours,
        label: finalLabel
      });
      curr.setDate(curr.getDate() + 1);
    }
  } else {
    // Single date
    const existingIdx = pageData.specialHours.findIndex(h => h.date === startDateStr);
    if (existingIdx !== -1) {
      pageData.specialHours.splice(existingIdx, 1);
    }
    pageData.specialHours.push({
      date: startDateStr,
      hours: finalHours,
      label: finalLabel
    });
  }

  // Sort by date (chronological order)
  pageData.specialHours.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Reset input fields
  dateInput.value = '';
  if (dateEndInput) dateEndInput.value = '';
  if (labelInput) labelInput.value = '';
  if (typeSelect) typeSelect.value = 'closed';
  const customInput = document.getElementById('new-special-hours-custom');
  if (customInput) customInput.value = '';

  handleSpecialTypeSelectChange();
  populateHoursTab();
  await commitDataChange('Admin Panel: Termin / Ausnahme geplant');
}

async function deleteSpecialHours(index) {
  if (!pageData.specialHours || !pageData.specialHours[index]) return;

  if (confirm('Möchten Sie diesen Termin / diese Ausnahme wirklich löschen?')) {
    pageData.specialHours.splice(index, 1);
    populateHoursTab();
    await commitDataChange('Admin Panel: Termin / Ausnahme gelöscht');
  }
}
