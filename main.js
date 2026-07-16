// Global data state
let appData = {};

// GitHub API and Raw URL definitions
const GITHUB_API_URL = 'https://api.github.com/repos/paulus-digital/naturfreundeschoenheide/contents/data.json?ref=data-sync';
const RAW_DATA_URL = 'https://raw.githubusercontent.com/paulus-digital/naturfreundeschoenheide/data-sync/data.json';

// Setup active tab polling
let pollInterval = null;
let slideshowInterval = null;
let calendarView = 'month';
let calendarDate = new Date();

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  // Poll every 4 seconds for instant updates when active
  pollInterval = setInterval(loadData, 4000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEventListeners();
  
  startPolling();

  // Close mobile navigation drawer when a link is clicked
  document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', () => {
      const nav = document.getElementById('navbar');
      const toggleBtn = document.querySelector('.mobile-nav-toggle');
      if (nav && nav.classList.contains('active')) {
        nav.classList.remove('active');
        if (toggleBtn) toggleBtn.textContent = '☰';
        document.body.style.overflow = '';
      }
    });
  });

  // Scroll Reveal Observer
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-active');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('section, .card, .carousel-wrapper').forEach(el => {
    el.classList.add('reveal-element');
    revealObserver.observe(el);
  });

  // Stop polling when tab is hidden (saves GitHub rate limits), start again when focused
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      loadData(); // immediate fetch on active
      startPolling();
    }
  });
});

// Load data.json – tries Firebase Realtime Database first, then falls back to GitHub repository/CDN
async function loadData() {
  try {
    let freshData = null;
    let baseConfig = null;

    // Step A: Load the base configuration from the local deployment or raw repository
    // This tells us the configured firebaseUrl
    try {
      const configResponse = await fetch(`data.json?t=${Date.now()}`);
      if (configResponse.ok) {
        baseConfig = await configResponse.json();
      }
    } catch (err) {
      console.warn('Fehler beim Laden der lokalen data.json Konfiguration:', err);
    }

    if (!baseConfig) {
      // Fallback: try raw repository data.json
      try {
        const rawConfigResponse = await fetch(`${RAW_DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (rawConfigResponse.ok) {
          baseConfig = await rawConfigResponse.json();
        }
      } catch (err) {
        console.warn('Fehler beim Laden der Repository data.json Konfiguration:', err);
      }
    }

    // Step B: If baseConfig and firebase exist, fetch directly from Firebase database for instant live state
    if (baseConfig && baseConfig.firebase && baseConfig.firebase.url) {
      try {
        let firebaseUrl = baseConfig.firebase.url;
        if (firebaseUrl.endsWith('/')) firebaseUrl = firebaseUrl.slice(0, -1);
        
        // Fetch anonymously (public read must be allowed in database rules)
        const dbResponse = await fetch(`${firebaseUrl}/data.json?t=${Date.now()}`);
        if (dbResponse.ok) {
          freshData = await dbResponse.json();
        }
      } catch (dbErr) {
        console.warn('Firebase-Abfrage fehlgeschlagen, weiche auf Repository aus:', dbErr);
      }
    }

    // Step C: Fallback loading flow if Firebase failed or is not configured
    if (!freshData) {
      try {
        const apiResponse = await fetch(GITHUB_API_URL, {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (apiResponse.ok) {
          const apiJson = await apiResponse.json();
          const decoded = decodeURIComponent(escape(atob(apiJson.content.replace(/\s/g, ''))));
          freshData = JSON.parse(decoded);
        }
      } catch (apiErr) {
        console.warn('GitHub API-Abfrage fehlgeschlagen, weiche auf Raw-Datei aus:', apiErr);
      }
    }

    // Step D: Fallback to raw CDN
    if (!freshData) {
      const rawResponse = await fetch(`${RAW_DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (rawResponse.ok) {
        freshData = await rawResponse.json();
      }
    }

    // Step E: Fallback to baseConfig if nothing else is available
    if (!freshData && baseConfig) {
      freshData = baseConfig;
    }

    if (!freshData) {
      throw new Error('Keine Datenquelle erreichbar.');
    }

    appData = freshData;

    renderWebsite();
  } catch (error) {
    console.error('Fehler beim Laden der Website-Daten:', error);
    // If everything fails, look in localStorage as fallback
    const backupData = localStorage.getItem('spartenheim_backup_data');
    if (backupData) {
      appData = JSON.parse(backupData);
      renderWebsite();
    }
  }
}

// Render dynamic elements
function renderWebsite() {
  if (!appData) return;

  // 0. Hero Background Image / Slideshow
  renderHeroSlideshow();

  // 1. Live Banner - respect session dismissal
  const liveBanner = document.getElementById('live-banner');
  const bannerText = document.getElementById('banner-text');
  const bannerDismissedText = sessionStorage.getItem('bannerDismissedText');
  if (appData.banner && appData.banner.visible && appData.banner.text.trim()) {
    bannerText.textContent = appData.banner.text;
    // Only show if user hasn't dismissed THIS exact banner text in this session
    if (bannerDismissedText !== appData.banner.text) {
      liveBanner.classList.remove('hidden');
    } else {
      liveBanner.classList.add('hidden');
    }
  } else {
    liveBanner.classList.add('hidden');
  }

  // 2. Live Open/Closed Status
  const liveStatus = document.getElementById('live-status');
  const statusText = liveStatus.querySelector('.status-text');
  if (appData.openStatus) {
    liveStatus.className = 'status-badge open';
    statusText.textContent = 'Geöffnet';
  } else {
    liveStatus.className = 'status-badge closed';
    statusText.textContent = 'Heute: Nicht geöffnet';
  }

  // 3. Opening Hours
  renderOpeningHours();

  // 4. Planner / Calendar
  renderCalendar();

  // 5. Gallery
  renderGallery();

  // 6. Guestbook Reviews
  renderGuestbook();

  // 7. Contact Details & Forms
  renderContact();

  // 8. Hide Preloader Overlay
  const preloader = document.getElementById('site-preloader');
  if (preloader) {
    preloader.style.opacity = '0';
    setTimeout(() => {
      if (preloader.parentNode) preloader.parentNode.removeChild(preloader);
    }, 500);
  }
}

// Helper: Translate Day Number to German Day Name
const GERMAN_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function renderOpeningHours() {
  const hoursList = document.getElementById('hours-list');
  if (!hoursList || !appData.openingHours) return;

  hoursList.innerHTML = '';
  
  // Get current day name in German
  const currentDayIndex = new Date().getDay();
  const currentDayGerman = GERMAN_DAYS[currentDayIndex];
  
  appData.openingHours.forEach(item => {
    const li = document.createElement('li');
    li.className = 'hours-row';
    
    const isToday = item.day.toLowerCase() === currentDayGerman.toLowerCase();
    if (isToday) {
      li.classList.add('current-day');
    }
    
    li.innerHTML = `
      <span>${item.day}</span>
      <span>${item.hours}</span>
    `;
    hoursList.appendChild(li);
  });
}

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function renderCalendar() {
  const title = document.getElementById('calendar-month-year');
  if (!title) return;

  if (calendarView === 'month') {
    title.textContent = `${MONTH_NAMES[calendarDate.getMonth()]} ${calendarDate.getFullYear()}`;
    document.getElementById('calendar-month-container').style.display = 'block';
    document.getElementById('calendar-week-container').style.display = 'none';
    document.getElementById('calendar-year-container').style.display = 'none';
    renderMonthView();
  } else if (calendarView === 'week') {
    const startOfWeek = getStartOfWeek(calendarDate);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    const startStr = `${startOfWeek.getDate()}. ${MONTH_NAMES[startOfWeek.getMonth()].substring(0,3)}`;
    const endStr = `${endOfWeek.getDate()}. ${MONTH_NAMES[endOfWeek.getMonth()].substring(0,3)}`;
    title.textContent = `${startStr} – ${endStr}`;
    document.getElementById('calendar-month-container').style.display = 'none';
    document.getElementById('calendar-week-container').style.display = 'block';
    document.getElementById('calendar-year-container').style.display = 'none';
    renderWeekView();
  } else {
    title.textContent = `${calendarDate.getFullYear()}`;
    document.getElementById('calendar-month-container').style.display = 'none';
    document.getElementById('calendar-week-container').style.display = 'none';
    document.getElementById('calendar-year-container').style.display = 'block';
    renderYearView();
  }
}

function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function getEventsForDate(dateObj) {
  if (!appData.planner) return [];
  const checkTime = new Date(dateObj).setHours(0,0,0,0);

  return appData.planner.filter(event => {
    const start = new Date(event.startDate || event.date);
    start.setHours(0,0,0,0);
    const end = new Date(event.endDate || event.startDate || event.date);
    end.setHours(23,59,59,999);
    return checkTime >= start.getTime() && checkTime <= end.getTime();
  });
}

const STATUS_PRIORITY = ['event', 'booked', 'holiday', 'closed', 'reservation', 'open', 'free'];

function summarizeStatus(events) {
  if (!events || events.length === 0) return 'free';
  // Return the most "severe"/notable status present for the day border/badge
  for (const s of STATUS_PRIORITY) {
    if (events.some(e => e.status === s)) return s;
  }
  return events[0].status;
}

// Determine whether a given date is an "open" day based on configured opening hours.
// Returns the status key used when there is NO planner event for that day:
// 'free' (open / reservation possible) or 'closed' (Ruhetag).
function getOpenStatusForDate(dateObj) {
  if (!appData.openingHours) return 'free';
  const dayName = GERMAN_DAYS[dateObj.getDay()];
  const match = appData.openingHours.find(h => h.day && h.day.toLowerCase() === dayName.toLowerCase());
  if (match && match.hours && match.hours.toLowerCase().includes('ruhetag')) {
    return 'closed';
  }
  return 'free';
}

function renderMonthView() {
  const daysContainer = document.getElementById('calendar-days');
  if (!daysContainer) return;
  daysContainer.innerHTML = '';

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const numDays = new Date(year, month + 1, 0).getDate();

  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  for (let i = 0; i < startOffset; i++) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'calendar-day empty';
    daysContainer.appendChild(emptyDiv);
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (let d = 1; d <= numDays; d++) {
    const currentDateObj = new Date(year, month, d);

    // Keep the grid aligned: render past days as empty, non-interactive cells
    // so the month layout stays correct but doesn't get cluttered.
    if (currentDateObj < yesterday) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'calendar-day empty past-hidden';
      daysContainer.appendChild(emptyDiv);
      continue;
    }

    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';

    if (currentDateObj.getTime() === today.getTime()) {
      dayDiv.classList.add('today');
    }

    const events = getEventsForDate(currentDateObj);
    let statusClass = 'status-free';
    if (events.length > 0) {
      statusClass = `status-${summarizeStatus(events)}`;
      dayDiv.classList.add(statusClass);
      if (events.length > 1) dayDiv.classList.add('has-multiple');
    } else {
      // No planner event: derive status from configured opening hours (Ruhetag -> closed)
      statusClass = `status-${getOpenStatusForDate(currentDateObj)}`;
      dayDiv.classList.add(statusClass);
    }

    const dotStatus = events.length > 0 ? summarizeStatus(events) : getOpenStatusForDate(currentDateObj);
    const dots = events.length > 0
      ? events.slice(0, 3).map(e => `<span class="calendar-day-status-indicator status-${e.status}"></span>`).join('')
      : `<span class="calendar-day-status-indicator status-${dotStatus}"></span>`;

    dayDiv.innerHTML = `
      <div class="calendar-day-num">${d}</div>
      <div class="calendar-day-dots">
        ${dots}
        ${events.length > 3 ? `<span class="calendar-day-more">+${events.length - 3}</span>` : ''}
      </div>
    `;

    dayDiv.onclick = () => selectCalendarDay(currentDateObj, events);
    daysContainer.appendChild(dayDiv);
  }
}

function renderWeekView() {
  const container = document.getElementById('calendar-week-days');
  if (!container) return;
  container.innerHTML = '';

  const startOfWeek = getStartOfWeek(calendarDate);
  const today = new Date();
  today.setHours(0,0,0,0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const GERMAN_DAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  for (let i = 0; i < 7; i++) {
    const currentDateObj = new Date(startOfWeek);
    currentDateObj.setDate(startOfWeek.getDate() + i);

    const events = getEventsForDate(currentDateObj);
    const statusClass = events.length > 0 ? `status-${summarizeStatus(events)}` : 'status-free';

    const row = document.createElement('div');
    row.className = `calendar-week-row ${statusClass}`;
    
    if (currentDateObj < yesterday) {
      row.classList.add('past-event');
    }

    const dayName = GERMAN_DAY_LABELS[currentDateObj.getDay()];
    const dateStr = currentDateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const eventItems = events.length > 0
      ? events.map(e => `<div class="week-event-item"><span class="week-event-dot status-${e.status}"></span>${escapeHTML(e.label)}</div>`).join('')
      : `<div class="week-event-item week-event-free">${getOpenStatusForDate(currentDateObj) === 'closed' ? 'Ruhetag – geschlossen' : 'Geöffnet / Reservierung möglich'}</div>`;

    row.innerHTML = `
      <div class="calendar-week-date-box">
        <span class="calendar-week-day-name">${dayName}</span>
        <span class="calendar-week-date-string">${dateStr}</span>
        <div class="week-event-list">${eventItems}</div>
      </div>
      <div class="calendar-week-status">${events.length} ${events.length === 1 ? 'Eintrag' : 'Einträge'}</div>
    `;

    row.onclick = () => selectCalendarDay(currentDateObj, events);
    container.appendChild(row);
  }
}

function renderYearView() {
  const container = document.getElementById('calendar-year-events');
  if (!container) return;
  container.innerHTML = '';

  if (!appData.planner || appData.planner.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 20px;">Keine Termine eingetragen.</p>';
    return;
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const events = appData.planner
    .filter(event => {
      const end = new Date(event.endDate || event.startDate || event.date);
      end.setHours(0,0,0,0);
      return end >= yesterday;
    })
    .sort((a, b) => new Date(a.startDate || a.date) - new Date(b.startDate || b.date));

  if (events.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 20px;">Keine anstehenden Termine.</p>';
    return;
  }

  const statusTranslations = {
    'open': 'Geöffnet',
    'booked': 'Ausgebucht',
    'closed': 'Geschlossen',
    'holiday': 'Urlaub/Betriebsferien',
    'reservation': 'Reservierung möglich',
    'event': 'Event'
  };

  events.forEach(event => {
    const start = new Date(event.startDate || event.date);
    const end = new Date(event.endDate || event.startDate || event.date);
    
    const row = document.createElement('div');
    const statusClass = `status-${event.status}`;
    row.className = `calendar-week-row ${statusClass}`;

    const isPast = end < today;
    if (isPast) {
      row.classList.add('past-event');
    }

    const startStr = start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const endStr = end.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const dateRangeStr = event.endDate && event.endDate !== event.startDate
      ? `${startStr}. – ${endStr}.`
      : `${startStr}.`;

    const badgeText = statusTranslations[event.status] || event.status;

    row.innerHTML = `
      <div class="calendar-week-date-box">
        <span class="calendar-week-day-name">${event.label}</span>
        <span class="calendar-week-date-string">${dateRangeStr} ${start.getFullYear()}</span>
      </div>
      <div class="calendar-week-status">${badgeText}</div>
    `;

    row.onclick = () => selectCalendarDay(start, [event]);
    container.appendChild(row);
  });
}

function selectCalendarDay(dateObj, event) {
  const detailsBox = document.getElementById('calendar-day-details');
  if (!detailsBox) return;

  const dateStr = dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  
  let statusKey = 'free';
  let statusText = 'Geöffnet / Reservierung möglich';
  if (!Array.isArray(event)) event = event ? [event] : [];

  const dayNameGerman = GERMAN_DAYS[dateObj.getDay()];

  let descText = 'Für diesen Tag liegen keine Belegungen vor. Rufen Sie uns gerne an, um eine Anfrage zu stellen.';

  if (event.length > 0) {
    statusKey = summarizeStatus(event);
    const statusTextTranslations = {
      'open': 'Geöffnet',
      'booked': 'Ausgebucht',
      'closed': 'Geschlossen',
      'holiday': 'Urlaub / Betriebsferien',
      'reservation': 'Reservierung möglich',
      'event': 'Sonder-Event'
    };
    statusText = statusTextTranslations[statusKey] || statusKey;
  } else {
    // No planner event: status follows the configured opening hours (Ruhetag -> closed)
    statusKey = getOpenStatusForDate(dateObj);
    if (statusKey === 'closed') {
      statusText = 'Ruhetag';
      descText = 'An diesem Tag haben wir Ruhetag und sind geschlossen.';
    } else {
      statusText = 'Geöffnet / Reservierung möglich';
    }
  }

  let hoursText = '';
  if (appData.openingHours) {
    const hoursMatch = appData.openingHours.find(h => h.day.toLowerCase() === dayNameGerman.toLowerCase());
    if (hoursMatch) {
      hoursText = `Reguläre Öffnungszeit: ${hoursMatch.hours}`;
    }
  }

  const phone = appData.contact ? appData.contact.phone : '+49 (0) 37755 12345';

  // Build the list of events for this day
  let eventsListHtml = '';
  if (event.length > 0) {
    const statusBadgeText = {
      'open': 'Geöffnet',
      'booked': 'Ausgebucht',
      'closed': 'Geschlossen',
      'holiday': 'Urlaub / Betriebsferien',
      'reservation': 'Reservierung möglich',
      'event': 'Event',
      'free': 'Frei'
    };
    eventsListHtml = event.map(e => {
      const sKey = e.status || 'free';
      const badge = statusBadgeText[sKey] || sKey;
      const label = escapeHTML(e.label || (e.status ? statusBadgeText[sKey] : 'Eintrag'));
      return `<li class="details-event-item">
        <span class="details-event-dot status-${sKey}"></span>
        <span class="details-event-label">${label}</span>
        <span class="details-status-badge ${sKey}">${badge}</span>
      </li>`;
    }).join('');
  }

  let actionButtonHtml = '';
  if (statusKey === 'free' || statusKey === 'open' || statusKey === 'reservation') {
    actionButtonHtml = `
      <a href="tel:${phone.replace(/\s+/g, '')}" class="details-action-btn">Jetzt Tisch anfragen (Anrufen: ${phone})</a>
    `;
  }

  detailsBox.innerHTML = `
    <div class="details-header">
      <span class="details-date">${dateStr}</span>
      <span class="details-status-badge ${statusKey}">${statusText}</span>
    </div>
    ${event.length > 0
      ? `<ul class="details-events-list">${eventsListHtml}</ul>`
      : `<p class="details-desc">${descText}</p>`}
    ${hoursText ? `<p class="details-hours">${hoursText}</p>` : ''}
    ${actionButtonHtml}
  `;

  detailsBox.style.display = 'block';

  if (window.innerWidth <= 768) {
    detailsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function setCalendarView(view) {
  calendarView = view;
  document.getElementById('view-month-btn').classList.toggle('active', view === 'month');
  document.getElementById('view-week-btn').classList.toggle('active', view === 'week');
  document.getElementById('view-year-btn').classList.toggle('active', view === 'year');
  renderCalendar();
  const details = document.getElementById('calendar-day-details');
  if (details) details.style.display = 'none';
}

function navigateCalendar(direction) {
  if (calendarView === 'month') {
    calendarDate.setMonth(calendarDate.getMonth() + direction);
  } else if (calendarView === 'week') {
    calendarDate.setDate(calendarDate.getDate() + (direction * 7));
  } else {
    calendarDate.setFullYear(calendarDate.getFullYear() + direction);
  }
  renderCalendar();
  const details = document.getElementById('calendar-day-details');
  if (details) details.style.display = 'none';
}

function renderGallery() {
  const container = document.getElementById('gallery-container');
  if (!container) return;

  container.innerHTML = '';

  if (!appData.gallery || appData.gallery.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="grid-column: 1/-1; padding: 40px;">Noch keine Bilder hochgeladen.</p>';
    return;
  }

  appData.gallery.forEach(img => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.onclick = () => openLightbox(img.src, img.alt);
    
    item.innerHTML = `
      <img src="${img.src}" alt="${img.alt || 'Galeriebild'}" onerror="this.src='logo.png'; this.style.objectFit='contain';">
      <div class="gallery-overlay">
        <div class="gallery-caption">${img.alt || 'Spartenheim Impression'}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderGuestbook() {
  const container = document.getElementById('reviews-container');
  if (!container) return;

  container.innerHTML = '';

  // Only display approved reviews
  const approvedReviews = (appData.guestbook || []).filter(r => r.approved);

  if (approvedReviews.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="grid-column: 1/-1; padding: 40px;">Noch keine Gästebucheinträge vorhanden. Seien Sie der Erste!</p>';
    return;
  }

  approvedReviews.forEach(r => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    const dateFormatted = new Date(r.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <div class="review-header">
        <div class="review-name">${escapeHTML(r.name)}</div>
        <div class="review-stars" aria-label="${r.rating} von 5 Sternen">${stars}</div>
      </div>
      <div class="review-text">"${escapeHTML(r.comment)}"</div>
      <div class="review-date">${dateFormatted}</div>
    `;
    container.appendChild(card);
  });
}

function renderContact() {
  if (!appData.contact) return;
  
  const c = appData.contact;
  
  // Set UI details
  document.getElementById('contact-address').textContent = c.address;
  document.getElementById('contact-phone').textContent = c.phone;
  document.getElementById('contact-phone-link').href = `tel:${c.phone.replace(/[^0-9+]/g, '')}`;
  document.getElementById('contact-inhaber').textContent = c.inhaber;
  
  // Modals placeholders
  document.querySelectorAll('.contact-phone-placeholder').forEach(el => el.textContent = c.phone);
  document.querySelectorAll('.contact-email-placeholder').forEach(el => el.textContent = c.email);
}

// Lightbox functions
function openLightbox(src, alt) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!lightbox || !img) return;

  img.src = src;
  img.alt = alt || '';
  lightbox.classList.add('active');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (lightbox) {
    lightbox.classList.remove('active');
  }
}

// Banner functions
function closeBanner() {
  const banner = document.getElementById('live-banner');
  if (banner) {
    banner.classList.add('hidden');
    // Remember dismissal for this session - store current banner text
    const bannerText = document.getElementById('banner-text');
    if (bannerText) {
      sessionStorage.setItem('bannerDismissedText', bannerText.textContent);
    }
  }
}

// Modal functions
function openModal(id) {
  const modal = document.getElementById(`${id}-modal`);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const modal = document.getElementById(`${id}-modal`);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Mobile Menu toggle
function toggleMobileMenu() {
  const nav = document.getElementById('navbar');
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  
  if (!nav) return;
  
  nav.classList.toggle('active');
  if (nav.classList.contains('active')) {
    toggleBtn.textContent = '✕';
    document.body.style.overflow = 'hidden';
  } else {
    toggleBtn.textContent = '☰';
    document.body.style.overflow = '';
  }
}

// Persist a guestbook entry to Firebase Realtime Database (pendingReviews node)
async function saveReviewToFirebase(review) {
  let firebaseUrl = null;
  if (appData && appData.firebase && appData.firebase.url) {
    firebaseUrl = appData.firebase.url;
  } else {
    const localConfig = await fetch(`data.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (localConfig && localConfig.firebase && localConfig.firebase.url) {
      firebaseUrl = localConfig.firebase.url;
    }
  }
  if (!firebaseUrl) return false;

  if (firebaseUrl.endsWith('/')) firebaseUrl = firebaseUrl.slice(0, -1);
  const endpoint = `${firebaseUrl}/pendingReviews.json`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review)
  });
  return response.ok;
}

// Setup reviews submit intercepts
function setupEventListeners() {
  const form = document.getElementById('review-form');
  const feedback = document.getElementById('form-feedback');
  
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('review-name-input').value.trim();
    const comment = document.getElementById('review-comment-input').value.trim();
    const ratingInput = form.querySelector('input[name="rating"]:checked');
    const rating = ratingInput ? parseInt(ratingInput.value) : 5;

    if (!name || !comment) {
      feedback.style.display = 'block';
      feedback.className = 'alert-box danger';
      feedback.textContent = 'Bitte geben Sie Namen und Kommentar an.';
      return;
    }

    const newReview = {
      name: name,
      rating: rating,
      comment: comment,
      date: new Date().toISOString().split('T')[0],
      approved: false,
      createdAt: Date.now()
    };

    // Save to Firebase Realtime Database (pendingReviews node, public write allowed)
    let savedToFirebase = false;
    try {
      savedToFirebase = await saveReviewToFirebase(newReview);
    } catch (err) {
      console.error('Firebase-Speicherung fehlgeschlagen:', err);
    }

    // Display feedback
    feedback.style.display = 'block';
    if (savedToFirebase) {
      feedback.className = 'alert-box success';
      feedback.textContent = 'Vielen Dank! Ihr Eintrag wurde gespeichert und wird nach Freigabe durch den Inhaber veröffentlicht.';
    } else {
      feedback.className = 'alert-box danger';
      feedback.textContent = 'Vielen Dank! Ihr Eintrag konnte nicht gespeichert werden. Bitte versuchen Sie es später erneut.';
    }

    // Reset form
    form.reset();
    setTimeout(() => {
      feedback.style.display = 'none';
    }, 8000);
  });

  // Close modals on background click
  window.addEventListener('click', (e) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
      if (e.target === modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  });
}

function renderHeroSlideshow() {
  const container = document.getElementById('hero-slideshow');
  if (!container) return;

  // Stop any existing intervals
  if (slideshowInterval) {
    clearInterval(slideshowInterval);
    slideshowInterval = null;
  }

  container.innerHTML = '';

  // Get slide images from DB or fallback to default
  let slides = [];
  if (appData.heroImages && appData.heroImages.filter(img => img).length > 0) {
    slides = appData.heroImages.filter(img => img);
  } else {
    // Fallback: use legacy heroImage or default cabin
    slides = [appData.heroImage || 'hero_cabin.png'];
  }

  // Create slide divs
  const singleSlide = slides.length <= 1;
  slides.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = `hero-slide ${singleSlide ? 'single' : ''} ${idx === 0 ? 'active' : ''}`;
    slide.style.backgroundImage = `linear-gradient(rgba(15, 36, 21, 0.55), rgba(15, 36, 21, 0.85)), url('${src}')`;
    container.appendChild(slide);
  });

  // If only 1 slide, no looping interval needed (single slide uses a smooth, non-repeating zoom)
  if (singleSlide) return;

  // Start fading slideshow loop
  let currentSlideIdx = 0;
  const slideElements = container.querySelectorAll('.hero-slide');
  slideshowInterval = setInterval(() => {
    if (!container.isConnected) {
      clearInterval(slideshowInterval);
      return;
    }
    slideElements[currentSlideIdx].classList.remove('active');
    currentSlideIdx = (currentSlideIdx + 1) % slideElements.length;
    slideElements[currentSlideIdx].classList.add('active');
  }, 5000);
}

// Carousel Scroll Helper
function scrollCarousel(direction) {
  const carousel = document.getElementById('gallery-container');
  if (!carousel) return;
  const scrollAmount = carousel.clientWidth * 0.8;
  carousel.scrollBy({
    left: direction * scrollAmount,
    behavior: 'smooth'
  });
}

// Reviews Scroll Helper
function scrollReviews(direction) {
  const carousel = document.getElementById('reviews-container');
  if (!carousel) return;
  const scrollAmount = carousel.clientWidth * 0.8;
  carousel.scrollBy({
    left: direction * scrollAmount,
    behavior: 'smooth'
  });
}

// Utility: HTML Escaper to prevent XSS in review forms
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
