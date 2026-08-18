// Global data state
let appData = {};
let currentDataTimestamp = 0;
let liveSyncInterval = null;

// GitHub API and Raw URL definitions
const GITHUB_API_URL = 'https://api.github.com/repos/paulus-digital/naturfreundeschoenheide/contents/data.json?ref=data-sync';
const RAW_DATA_URL = 'https://raw.githubusercontent.com/paulus-digital/naturfreundeschoenheide/data-sync/data.json';

let slideshowInterval = null;
let calendarView = 'month';
let calendarDate = new Date();

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEventListeners();
  startLiveSync();

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

  // Prevent default scrolling for #kontakt anchors and scroll to top instead
  document.querySelectorAll('a[href="#kontakt"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // On page load, if URL contains #kontakt, scroll to top
  if (window.location.hash === '#kontakt') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Handle tab visibility: pause sync in background, check instantly on return
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLiveSync();
    } else {
      checkLiveUpdates();
      startLiveSync();
    }
  });
});

// Lightweight 13-Byte Realtime Sync: checks only lastUpdated timestamp from Firebase
function startLiveSync() {
  if (liveSyncInterval) clearInterval(liveSyncInterval);
  // Check every 10 seconds (transfers only ~13 bytes per check)
  liveSyncInterval = setInterval(checkLiveUpdates, 10000);
}

function stopLiveSync() {
  if (liveSyncInterval) {
    clearInterval(liveSyncInterval);
    liveSyncInterval = null;
  }
}

async function checkLiveUpdates() {
  if (document.hidden) return;

  let firebaseUrl = appData && appData.firebase ? appData.firebase.url : null;
  if (!firebaseUrl) {
    try {
      const cfgRes = await fetch(`data.json?t=${Date.now()}`);
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg && cfg.firebase) firebaseUrl = cfg.firebase.url;
      }
    } catch(e) {}
  }
  if (!firebaseUrl) return;
  if (firebaseUrl.endsWith('/')) firebaseUrl = firebaseUrl.slice(0, -1);

  try {
    // Micro-request: ONLY fetch the lastUpdated timestamp number (13 bytes)
    const res = await fetch(`${firebaseUrl}/data/lastUpdated.json?t=${Date.now()}`);
    if (res.ok) {
      const remoteTimestamp = await res.json();
      if (remoteTimestamp && currentDataTimestamp && remoteTimestamp !== currentDataTimestamp) {
        console.log('⚡ Neue Änderungen im Backend gespeichert – lade Update in Echtzeit!');
        await loadData();
      }
    }
  } catch (e) {
    // Silent fail if network unreachable
  }
}

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
    currentDataTimestamp = freshData.lastUpdated || Date.now();

    renderWebsite();
  } catch (error) {
    console.error('Fehler beim Laden der Website-Daten:', error);
    // If everything fails, look in localStorage as fallback
    const backupData = localStorage.getItem('naturfreunde_backup_data');
    if (backupData) {
      appData = JSON.parse(backupData);
      renderWebsite();
    }
  }
}

let currentHeroSlideIndex = 0;
let heroSlideshowTimer = null;
let lastHeroImagesKey = '';

function renderHeroSlideshow() {
  const container = document.getElementById('hero-slideshow');
  if (!container) return;

  // Determine list of images
  let images = [];
  if (appData.heroImages && Array.isArray(appData.heroImages)) {
    images = appData.heroImages.filter(img => img && img.trim().length > 0);
  }
  if (images.length === 0 && appData.heroImage) {
    images = [appData.heroImage];
  }
  if (images.length === 0) {
    images = ['hero_cabin.png'];
  }

  // Avoid re-rendering DOM unnecessarily on polling
  const imagesKey = JSON.stringify(images);
  if (imagesKey === lastHeroImagesKey && container.children.length > 0) {
    return;
  }
  lastHeroImagesKey = imagesKey;

  // Clear timer & container
  if (heroSlideshowTimer) {
    clearInterval(heroSlideshowTimer);
    heroSlideshowTimer = null;
  }
  container.innerHTML = '';
  currentHeroSlideIndex = 0;

  // Create slide elements
  images.forEach((imgSrc, idx) => {
    const slide = document.createElement('div');
    slide.className = idx === 0 ? 'hero-slide active' : 'hero-slide';
    slide.style.backgroundImage = `url('${imgSrc}')`;
    container.appendChild(slide);
  });

  // If more than 1 image, auto-advance slides every 5 seconds
  if (images.length > 1) {
    heroSlideshowTimer = setInterval(() => {
      const slides = container.querySelectorAll('.hero-slide');
      if (slides.length <= 1) return;

      slides[currentHeroSlideIndex].classList.remove('active');
      currentHeroSlideIndex = (currentHeroSlideIndex + 1) % slides.length;
      slides[currentHeroSlideIndex].classList.add('active');
    }, 5000);
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
  
  // Update header positioning immediately
  if (typeof handleScroll === 'function') {
    handleScroll();
  }

  // 2. Live Open/Closed Status (derived from today's planner + opening hours)
  renderLiveStatus();

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

function formatDateToYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDatesForCurrentWeek() {
  const today = new Date();
  const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday...
  const mondayDiff = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayDiff);
  monday.setHours(0,0,0,0);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + i);
    dates.push(dayDate);
  }
  return dates;
}

function renderOpeningHours() {
  const hoursList = document.getElementById('hours-list');
  if (!hoursList || !appData.openingHours) return;

  hoursList.innerHTML = '';
  
  // Get current day name in German
  const currentDayIndex = new Date().getDay();
  const currentDayGerman = GERMAN_DAYS[currentDayIndex];
  const dates = getDatesForCurrentWeek();
  
  appData.openingHours.forEach(item => {
    const li = document.createElement('li');
    li.className = 'hours-row';
    
    const isToday = item.day.toLowerCase() === currentDayGerman.toLowerCase();
    if (isToday) {
      li.classList.add('current-day');
    }

    // Find if this day has a special opening hour planned in the current week
    const dayDate = dates.find(d => GERMAN_DAYS[d.getDay()].toLowerCase() === item.day.toLowerCase());
    const dateFormatted = dayDate ? ` (${dayDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})` : '';
    
    let specialMatch = null;
    if (dayDate && appData.specialHours) {
      const dateStr = formatDateToYYYYMMDD(dayDate);
      specialMatch = appData.specialHours.find(h => h.date === dateStr);
    }
    
    if (specialMatch) {
      li.classList.add('special-day');
      li.innerHTML = `
        <span>
          ${item.day}${dateFormatted}
          <span class="special-hours-badge" title="${escapeHTML(specialMatch.label)}">${escapeHTML(specialMatch.label || 'Sonderregelung')}</span>
        </span>
        <span class="special-hours-time">${escapeHTML(specialMatch.hours)}</span>
      `;
    } else {
      li.innerHTML = `
        <span>${item.day}${dateFormatted}</span>
        <span>${item.hours}</span>
      `;
    }
    hoursList.appendChild(li);
  });
}
function getTodayHoursString() {
  const today = new Date();
  const dateStr = formatDateToYYYYMMDD(today);

  // 1. Special hours for today
  if (appData.specialHours) {
    const special = appData.specialHours.find(h => h.date === dateStr);
    if (special && special.hours && !special.hours.toLowerCase().includes('geschlossen') && !special.hours.toLowerCase().includes('ruhetag')) {
      return special.hours;
    }
  }

  // 2. Regular opening hours for today
  if (appData.openingHours) {
    const dayName = GERMAN_DAYS[today.getDay()];
    const match = appData.openingHours.find(h => h.day && h.day.toLowerCase() === dayName.toLowerCase());
    if (match && match.hours && !match.hours.toLowerCase().includes('geschlossen') && !match.hours.toLowerCase().includes('ruhetag')) {
      return match.hours;
    }
  }

  return '';
}

// Derive today's live status from the planner + configured opening hours
function renderLiveStatus() {
  const liveStatus = document.getElementById('live-status');
  const liveDetail = document.getElementById('live-status-detail');
  if (!liveStatus) return;

  const statusText = liveStatus.querySelector('.status-text');
  const today = new Date();
  const todayEvents = getEventsForDate(today);
  const dayStatus = todayEvents.length > 0 ? summarizeStatus(todayEvents) : getOpenStatusForDate(today);

  const STATUS_LABEL = {
    'open': 'Geöffnet',
    'free': 'Geöffnet',
    'closed': 'Geschlossen',
    'booked': 'Ausgebucht',
    'holiday': 'Im Urlaub',
    'event': 'Event-Tag',
    'request': 'Nur auf Anfrage',
    'reservation': 'Nur auf Anfrage'
  };

  const label = STATUS_LABEL[dayStatus] || 'Geschlossen';
  liveStatus.className = `status-banner ${dayStatus === 'free' || dayStatus === 'open' ? 'open' : dayStatus}`;
  liveStatus.querySelector('.status-dot').className = 'status-dot';

  if (dayStatus === 'free' || dayStatus === 'open') {
    const todayHours = getTodayHoursString();
    statusText.textContent = todayHours ? `Heute geöffnet: ${todayHours}` : `Heute geöffnet`;
  } else if (dayStatus === 'closed') {
    statusText.textContent = `Heute geschlossen`;
  } else if (dayStatus === 'holiday') {
    statusText.textContent = `Heute: Im Urlaub`;
  } else if (dayStatus === 'event') {
    statusText.textContent = `Heute: Sonder-Event`;
  } else if (dayStatus === 'booked') {
    statusText.textContent = `Heute: Ausgebucht`;
  } else {
    statusText.textContent = `Heute: ${label}`;
  }

  // Build detail text
  let detailHtml = '';

  if (dayStatus === 'holiday') {
    const ev = todayEvents.find(e => e.status === 'holiday') || {};
    const fmt = d => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const start = ev.startDate || ev.date ? fmt(ev.startDate || ev.date) : '';
    const end = ev.endDate ? fmt(ev.endDate) : start;
    const range = (start && end && start !== end) ? `${start} bis ${end}` : (start || '');
    detailHtml = `<strong>Wir sind im Urlaub${range ? ' (' + range + ')' : ''}.</strong><br>Bis bald – wir freuen uns auf Ihren nächsten Besuch!`;
  } else if (dayStatus === 'event' || dayStatus === 'booked') {
    const evs = todayEvents.filter(e => e.status === 'event' || e.status === 'booked');
    detailHtml = evs.map(e => `<div class="live-detail-event"><span class="week-event-dot status-${e.status}"></span>${escapeHTML(e.label)}</div>`).join('');
  } else if (dayStatus === 'closed') {
    const specialToday = appData.specialHours && appData.specialHours.find(h => h.date === formatDateToYYYYMMDD(today));
    if (specialToday) {
      detailHtml = `Heute geschlossen: ${escapeHTML(specialToday.label || 'Sonderregelung')} (${escapeHTML(specialToday.hours)})`;
    } else {
      detailHtml = 'Heute bleibt die Gaststätte geschlossen. Schauen Sie auf die Öffnungszeiten für unsere nächsten geöffneten Tage.';
    }
  } else {
    const specialToday = appData.specialHours && appData.specialHours.find(h => h.date === formatDateToYYYYMMDD(today));
    if (specialToday) {
      detailHtml = `Heute geänderte Öffnungszeit: <strong>${escapeHTML(specialToday.hours)}</strong> ${specialToday.label ? '(' + escapeHTML(specialToday.label) + ')' : ''}`;
    } else {
      const todayHours = getTodayHoursString();
      detailHtml = `Wir haben heute für Sie geöffnet${todayHours ? ' (' + todayHours + ')' : ''}. Reservieren Sie gerne einen Tisch – wir freuen uns auf Sie!`;
    }
  }

  if (liveDetail) {
    liveDetail.innerHTML = detailHtml;
    // Event / booked / holiday are expandable
    const expandable = (dayStatus === 'event' || dayStatus === 'booked' || dayStatus === 'holiday');
    if (expandable) {
      liveStatus.classList.add('clickable');
      liveStatus.setAttribute('aria-expanded', 'false');
      liveStatus.onclick = () => {
        const open = liveStatus.getAttribute('aria-expanded') === 'true';
        liveStatus.setAttribute('aria-expanded', String(!open));
        liveDetail.hidden = open;
      };
    } else {
      liveStatus.classList.remove('clickable');
      liveStatus.onclick = null;
      liveDetail.hidden = true;
    }
  }
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
  const events = [];
  const checkTime = new Date(dateObj).setHours(0,0,0,0);
  const dateStr = formatDateToYYYYMMDD(dateObj);

  // 1. Planner events
  if (appData.planner) {
    appData.planner.forEach(event => {
      const start = new Date(event.startDate || event.date);
      start.setHours(0,0,0,0);
      const end = new Date(event.endDate || event.startDate || event.date);
      end.setHours(23,59,59,999);
      if (checkTime >= start.getTime() && checkTime <= end.getTime()) {
        events.push({
          ...event,
          isPlanner: true
        });
      }
    });
  }

  // 2. Special Opening Hours (Sonderöffnungszeiten)
  if (appData.specialHours) {
    const specialMatch = appData.specialHours.find(h => h.date === dateStr);
    if (specialMatch) {
      const hLower = (specialMatch.hours || '').toLowerCase();
      const lLower = (specialMatch.label || '').toLowerCase();
      const typeLower = (specialMatch.type || '').toLowerCase();

      let status = 'event';
      if (typeLower === 'holiday' || hLower.includes('urlaub') || hLower.includes('betriebsferien') || lLower.includes('urlaub') || lLower.includes('betriebsferien')) {
        status = 'holiday';
      } else if (typeLower === 'closed' || hLower.includes('ruhetag') || hLower.includes('geschlossen')) {
        status = 'closed';
      } else if (typeLower === 'open' || typeLower === 'free' || (hLower.includes('-') && !lLower.includes('event'))) {
        status = 'free';
      } else if (typeLower === 'booked' || hLower.includes('ausgebucht')) {
        status = 'booked';
      } else if (typeLower === 'event' || lLower.includes('event') || lLower.includes('fest') || lLower.includes('feier')) {
        status = 'event';
      }

      const displayTitle = specialMatch.label 
        ? `${specialMatch.label}: ${specialMatch.hours}`
        : (status === 'holiday' ? `Betriebsferien / Urlaub: ${specialMatch.hours}` : `Sonderzeit: ${specialMatch.hours}`);

      events.push({
        date: dateStr,
        startDate: dateStr,
        endDate: dateStr,
        status: status,
        label: displayTitle,
        hours: specialMatch.hours,
        specialLabel: specialMatch.label,
        isSpecial: true
      });
    }
  }

  return events;
}

const STATUS_PRIORITY = ['holiday', 'closed', 'booked', 'event', 'request', 'reservation', 'open', 'free'];

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
// 'free' (open / reservation possible), 'request' (Nur auf Anfrage), or 'closed' (Ruhetag).
function getOpenStatusForDate(dateObj) {
  if (appData.specialHours) {
    const dateStr = formatDateToYYYYMMDD(dateObj);
    const specialMatch = appData.specialHours.find(h => h.date === dateStr);
    if (specialMatch) {
      const hLower = (specialMatch.hours || '').toLowerCase();
      if (hLower.includes('ruhetag') || hLower.includes('geschlossen') || hLower.includes('nicht geöffnet')) {
        return 'closed';
      }
      if (hLower.includes('anfrage')) {
        return 'request';
      }
      return 'free';
    }
  }

  if (!appData.openingHours) return 'free';
  const dayName = GERMAN_DAYS[dateObj.getDay()];
  const match = appData.openingHours.find(h => h.day && h.day.toLowerCase() === dayName.toLowerCase());
  if (match && match.hours) {
    const hLower = match.hours.toLowerCase();
    if (hLower.includes('ruhetag') || hLower.includes('geschlossen') || hLower.includes('nicht geöffnet') || hLower.includes('zu')) return 'closed';
    if (hLower.includes('anfrage')) return 'request';
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
    currentDateObj.setHours(0,0,0,0);

    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';

    const isPast = currentDateObj < today;
    if (isPast) {
      dayDiv.classList.add('past');
    }

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

    if (!isPast) {
      dayDiv.onclick = () => selectCalendarDay(currentDateObj, events);
    }
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

  const GERMAN_DAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  for (let i = 0; i < 7; i++) {
    const currentDateObj = new Date(startOfWeek);
    currentDateObj.setDate(startOfWeek.getDate() + i);

    // Skip days that are already in the past (only show from today onward)
    if (currentDateObj < today) continue;

    const events = getEventsForDate(currentDateObj);
    const statusClass = events.length > 0 ? `status-${summarizeStatus(events)}` : 'status-free';

    const row = document.createElement('div');
    row.className = `calendar-week-row ${statusClass}`;

    const dayName = GERMAN_DAY_LABELS[currentDateObj.getDay()];
    const dateStr = currentDateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const eventItems = events.length > 0
      ? events.map(e => `<div class="week-event-item"><span class="week-event-dot status-${e.status}"></span>${escapeHTML(e.label)}</div>`).join('')
      : `<div class="week-event-item week-event-free">${getOpenStatusForDate(currentDateObj) === 'closed' ? 'Geschlossen' : 'Geöffnet / Reservierung möglich'}</div>`;

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

  const today = new Date();
  today.setHours(0,0,0,0);

  const combinedItems = [];

  // 1. Planner entries (multi-day events, booked dates, holiday ranges)
  if (appData.planner && Array.isArray(appData.planner)) {
    appData.planner.forEach(event => {
      const startStr = event.startDate || event.date;
      const endStr = event.endDate || event.startDate || event.date;
      if (!startStr) return;

      const endParts = endStr.split('-');
      if (endParts.length === 3) {
        const endDateObj = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10), 23, 59, 59, 999);
        if (endDateObj < today) return; // Hide past entries automatically!
      }

      combinedItems.push({
        startDate: startStr,
        endDate: endStr,
        status: event.status || 'event',
        label: event.label || 'Termin',
        isPlanner: true
      });
    });
  }

  // 2. Special Opening Hours entries (Urlaub, Sonderöffnungszeiten, Events)
  if (appData.specialHours && Array.isArray(appData.specialHours)) {
    // Filter out past dates first
    const activeSpecial = appData.specialHours.filter(h => {
      if (!h.date) return false;
      const parts = h.date.split('-');
      if (parts.length === 3) {
        const dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 23, 59, 59, 999);
        return dObj >= today;
      }
      return true;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    // Group consecutive 'holiday' (Urlaub) days into a single Von-Bis range
    let currentHolidayRange = null;

    activeSpecial.forEach(item => {
      const hLower = (item.hours || '').toLowerCase();
      const lLower = (item.label || '').toLowerCase();
      const typeLower = (item.type || '').toLowerCase();

      let status = 'event';
      if (typeLower === 'holiday' || hLower.includes('urlaub') || hLower.includes('betriebsferien') || lLower.includes('urlaub') || lLower.includes('betriebsferien')) {
        status = 'holiday';
      } else if (typeLower === 'closed' || hLower.includes('ruhetag') || hLower.includes('geschlossen')) {
        status = 'closed';
      } else if (typeLower === 'booked' || hLower.includes('ausgebucht')) {
        status = 'booked';
      } else if (typeLower === 'open' || typeLower === 'free') {
        status = 'free';
      }

      // If it's a holiday, try to merge with previous consecutive holiday date
      if (status === 'holiday') {
        const itemDateParts = item.date.split('-');
        const itemDate = new Date(parseInt(itemDateParts[0], 10), parseInt(itemDateParts[1], 10) - 1, parseInt(itemDateParts[2], 10));
        itemDate.setHours(0,0,0,0);

        if (currentHolidayRange) {
          const lastDateParts = currentHolidayRange.endDate.split('-');
          const lastDate = new Date(parseInt(lastDateParts[0], 10), parseInt(lastDateParts[1], 10) - 1, parseInt(lastDateParts[2], 10));
          lastDate.setHours(0,0,0,0);
          const dayDiff = Math.round((itemDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

          if (dayDiff <= 1) {
            // Extend range
            currentHolidayRange.endDate = item.date;
            return;
          }
        }

        // Start new holiday range
        currentHolidayRange = {
          startDate: item.date,
          endDate: item.date,
          status: 'holiday',
          label: item.label || 'Betriebsferien / Urlaub',
          isSpecialGroup: true
        };
        combinedItems.push(currentHolidayRange);
      } else {
        currentHolidayRange = null;
        // Include non-standard events/exceptions
        if (status !== 'free') {
          combinedItems.push({
            startDate: item.date,
            endDate: item.date,
            status: status,
            label: item.label ? `${item.label}` : (item.hours || 'Sonderöffnung'),
            isSpecial: true
          });
        }
      }
    });
  }

  // Sort combined items by startDate
  combinedItems.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  if (combinedItems.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding: 20px;">Keine anstehenden Termine oder Betriebsferien eingetragen.</p>';
    return;
  }

  const statusTranslations = {
    'open': 'Geöffnet',
    'free': 'Geöffnet',
    'booked': 'Ausgebucht',
    'closed': 'Geschlossen',
    'holiday': 'Urlaub / Betriebsferien',
    'reservation': 'Reservierung möglich',
    'event': 'Event'
  };

  combinedItems.forEach(item => {
    const startParts = item.startDate.split('-');
    const endParts = item.endDate.split('-');
    
    const start = new Date(parseInt(startParts[0], 10), parseInt(startParts[1], 10) - 1, parseInt(startParts[2], 10));
    const end = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10));

    const startStr = start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const endStr = end.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const dateRangeStr = item.endDate && item.endDate !== item.startDate
      ? `${startStr}. – ${endStr}`
      : `${startStr}. ${start.getFullYear()}`;

    const row = document.createElement('div');
    row.className = `calendar-week-row status-${item.status}`;

    const badgeText = statusTranslations[item.status] || item.status;

    row.innerHTML = `
      <div class="calendar-week-date-box">
        <strong class="calendar-week-day-name" style="font-size: 1.05rem; color: var(--primary-dark); display: block; margin-bottom: 2px;">${item.label}</strong>
        <span class="calendar-week-date-string" style="font-weight: 600; color: var(--text-dark);">${dateRangeStr}</span>
      </div>
      <div class="calendar-week-status">${badgeText}</div>
    `;

    row.onclick = () => selectCalendarDay(start, [item]);
    container.appendChild(row);
  });
}

function selectCalendarDay(dateObj, event) {
  const detailsBox = document.getElementById('calendar-day-details');
  if (!detailsBox) return;

  const dateStr = dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  
  let statusKey = 'free';
  let statusText = 'Geöffnet';
  if (!Array.isArray(event)) event = event ? [event] : [];

  const dayNameGerman = GERMAN_DAYS[dateObj.getDay()];

  let descText = 'Wir haben an diesem Tag regulär geöffnet. Kommen Sie gerne vorbei!';

  if (event.length > 0) {
    statusKey = summarizeStatus(event);
    const statusTextTranslations = {
      'open': 'Geöffnet',
      'booked': 'Ausgebucht',
      'closed': 'Geschlossen',
      'holiday': 'Urlaub / Betriebsferien',
      'reservation': 'Nur auf Anfrage',
      'request': 'Nur auf Anfrage',
      'event': 'Sonder-Event'
    };
    statusText = statusTextTranslations[statusKey] || statusKey;
  } else {
    // No planner event: status follows the configured opening hours
    statusKey = getOpenStatusForDate(dateObj);
    if (statusKey === 'closed') {
      statusText = 'Geschlossen';
      descText = 'An diesem Tag bleibt die Gaststätte geschlossen.';
    } else if (statusKey === 'request') {
      statusText = 'Nur auf Anfrage';
      descText = 'An diesem Tag haben wir nicht regulär geöffnet. Wir stehen jedoch nach Absprache sehr gerne für Feiern, Gruppen & Veranstaltungen zur Verfügung. Rufen Sie uns einfach an!';
    } else {
      statusText = 'Geöffnet';
      descText = 'Wir haben an diesem Tag regulär geöffnet. Kommen Sie gerne vorbei!';
    }
  }

  let hoursText = '';
  let actualHours = '';

  // 1. Check special opening hours first
  if (appData.specialHours) {
    const dateStr = formatDateToYYYYMMDD(dateObj);
    const specialMatch = appData.specialHours.find(h => h.date === dateStr);
    if (specialMatch) {
      actualHours = specialMatch.hours;
    }
  }

  // 2. Check if there is a planner event that specifies hours or status
  if (!actualHours && event.length > 0) {
    const mainEvent = event[0];
    if (mainEvent.hours) {
      actualHours = mainEvent.hours;
    } else {
      const statusHoursMap = {
        'closed': 'Geschlossen',
        'holiday': 'Betriebsferien',
        'request': 'Nur auf Anfrage'
      };
      actualHours = statusHoursMap[mainEvent.status] || '';
    }
  }

  // 3. Fallback to regular hours
  if (!actualHours && appData.openingHours) {
    const hoursMatch = appData.openingHours.find(h => h.day.toLowerCase() === dayNameGerman.toLowerCase());
    if (hoursMatch) {
      actualHours = hoursMatch.hours;
    }
  }

  if (actualHours) {
    hoursText = `Öffnungszeit: ${actualHours}`;
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
      'request': 'Nur auf Anfrage',
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
  if (statusKey === 'free' || statusKey === 'open' || statusKey === 'reservation' || statusKey === 'request') {
    actionButtonHtml = `
      <a href="tel:${phone.replace(/\s+/g, '')}" class="details-action-btn">
        <span class="details-btn-title">Tisch &amp; Feier anfragen</span>
        <span class="details-btn-phone">📞 Anrufen: ${phone}</span>
      </a>
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

let currentGalleryIndex = 0;

function renderGallery() {
  const container = document.getElementById('gallery-container');
  const thumbStrip = document.getElementById('gallery-thumbnails-strip');
  if (!container) return;

  container.innerHTML = '';
  if (thumbStrip) thumbStrip.innerHTML = '';

  if (!appData.gallery || appData.gallery.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="grid-column: 1/-1; padding: 40px;">Noch keine Bilder hochgeladen.</p>';
    if (thumbStrip) thumbStrip.style.display = 'none';
    return;
  }

  if (thumbStrip) thumbStrip.style.display = 'flex';

  if (currentGalleryIndex >= appData.gallery.length) {
    currentGalleryIndex = 0;
  }

  appData.gallery.forEach((img, idx) => {
    // Main gallery card
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.id = `gallery-item-${idx}`;
    item.onclick = () => openLightbox(img.src, img.alt);
    
    item.innerHTML = `
      <img src="${img.src}" alt="${img.alt || 'Galeriebild'}" onerror="this.src='logo.png'; this.style.objectFit='contain';">
      <div class="gallery-overlay">
        <div class="gallery-caption">${img.alt || 'Impression Gaststätte'}</div>
      </div>
    `;
    container.appendChild(item);

    // Thumbnail
    if (thumbStrip) {
      const thumb = document.createElement('div');
      thumb.className = `gallery-thumb-item ${idx === currentGalleryIndex ? 'active' : ''}`;
      thumb.id = `gallery-thumb-${idx}`;
      thumb.title = img.alt || `Bild ${idx + 1}`;
      thumb.onclick = (e) => {
        e.stopPropagation();
        goToGallerySlide(idx);
      };
      thumb.innerHTML = `<img src="${img.src}" alt="${img.alt || 'Miniatur'}" onerror="this.src='logo.png';">`;
      thumbStrip.appendChild(thumb);
    }
  });
}

function scrollGallery(direction) {
  if (!appData.gallery || appData.gallery.length === 0) return;

  const total = appData.gallery.length;
  // Seamless infinite wrap-around
  currentGalleryIndex = (currentGalleryIndex + direction + total) % total;
  goToGallerySlide(currentGalleryIndex);
}

function goToGallerySlide(index) {
  if (!appData.gallery || appData.gallery.length === 0) return;
  currentGalleryIndex = index;

  const container = document.getElementById('gallery-container');
  const targetItem = document.getElementById(`gallery-item-${index}`);

  if (container && targetItem) {
    const offset = targetItem.offsetLeft - container.offsetLeft - (container.clientWidth / 2) + (targetItem.clientWidth / 2);
    container.scrollTo({
      left: Math.max(0, offset),
      behavior: 'smooth'
    });
  }

  // Update thumbnail active highlight and smoothly center thumbnail within thumbStrip WITHOUT scrolling the page
  const thumbStrip = document.getElementById('gallery-thumbnails-strip');
  document.querySelectorAll('.gallery-thumb-item').forEach((th, idx) => {
    if (idx === index) {
      th.classList.add('active');
      if (thumbStrip && thumbStrip.scrollWidth > thumbStrip.clientWidth) {
        const thumbOffset = th.offsetLeft - thumbStrip.offsetLeft - (thumbStrip.clientWidth / 2) + (th.clientWidth / 2);
        thumbStrip.scrollTo({
          left: Math.max(0, thumbOffset),
          behavior: 'smooth'
        });
      }
    } else {
      th.classList.remove('active');
    }
  });
}

function scrollCarousel(direction) {
  scrollGallery(direction);
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
  const rawPhone = (c.phone || '').replace(/[^0-9+]/g, '') || '01724258894';
  const displayPhone = c.phone || '0172 4258894';
  const email = c.email || 'info@spartenheim-schoenheide.de';
  const inhaber = c.inhaber || 'Ina Schultze';
  
  // Set UI details
  if (document.getElementById('contact-address')) document.getElementById('contact-address').textContent = c.address || 'Gartenweg 5, 08304 Schönheide';
  if (document.getElementById('contact-phone')) document.getElementById('contact-phone').textContent = displayPhone;
  if (document.getElementById('contact-phone-link')) document.getElementById('contact-phone-link').href = `tel:${rawPhone}`;
  if (document.getElementById('contact-inhaber')) document.getElementById('contact-inhaber').textContent = inhaber;

  // Header, Hero, Event, and Impressum call buttons
  ['nav-call-btn', 'hero-call-btn', 'event-call-btn', 'impressum-phone-link'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.href = `tel:${rawPhone}`;
  });

  if (document.getElementById('event-call-btn-phone')) {
    document.getElementById('event-call-btn-phone').textContent = `(${displayPhone})`;
  }

  // Impressum
  if (document.getElementById('impressum-phone')) document.getElementById('impressum-phone').textContent = displayPhone;
  if (document.getElementById('impressum-email')) document.getElementById('impressum-email').textContent = email;
  if (document.getElementById('impressum-email-link')) document.getElementById('impressum-email-link').href = `mailto:${email}`;
  if (document.getElementById('impressum-inhaber-rep')) document.getElementById('impressum-inhaber-rep').textContent = `${inhaber} (Inhaberin)`;
  if (document.getElementById('impressum-inhaber-resp')) document.getElementById('impressum-inhaber-resp').textContent = inhaber;
  
  // Modals placeholders
  document.querySelectorAll('.contact-phone-placeholder').forEach(el => el.textContent = displayPhone);
  document.querySelectorAll('.contact-email-placeholder').forEach(el => el.textContent = email);
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
    // Update layout offset immediately after closing the banner
    if (typeof handleScroll === 'function') {
      handleScroll();
    }
  }
}

// Scroll, banner offset and Hero parallax handler
function handleScroll() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;

  // 1. Update banner offset CSS variable for fixed header positioning and hero padding-top
  const liveBanner = document.getElementById('live-banner');
  if (liveBanner) {
    const isBannerVisible = !liveBanner.classList.contains('hidden');
    if (isBannerVisible) {
      const bannerHeight = liveBanner.offsetHeight || 45;
      const offset = Math.max(0, bannerHeight - scrollTop);
      document.documentElement.style.setProperty('--banner-offset', `${offset}px`);
    } else {
      document.documentElement.style.setProperty('--banner-offset', '0px');
    }
  } else {
    document.documentElement.style.setProperty('--banner-offset', '0px');
  }

  // 2. Parallax effect for Hero background slideshow
  const slideshow = document.getElementById('hero-slideshow');
  if (slideshow && scrollTop < window.innerHeight) {
    slideshow.style.transform = `translateY(${scrollTop * 0.4}px)`;
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

// Mobile Menu toggle & close
function closeMobileMenu() {
  const nav = document.getElementById('navbar');
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  const backdrop = document.getElementById('nav-backdrop');
  if (nav) nav.classList.remove('active');
  if (toggleBtn) toggleBtn.textContent = '☰';
  document.body.style.overflow = '';
  if (backdrop) {
    backdrop.classList.remove('visible');
    backdrop.hidden = true;
  }
}

function toggleMobileMenu() {
  const nav = document.getElementById('navbar');
  const toggleBtn = document.querySelector('.mobile-nav-toggle');
  const backdrop = document.getElementById('nav-backdrop');
  
  if (!nav) return;
  
  nav.classList.toggle('active');
  const open = nav.classList.contains('active');
  toggleBtn.textContent = open ? '✕' : '☰';
  document.body.style.overflow = open ? 'hidden' : '';
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.toggle('visible', open);
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

  // Scroll and Resize handlers for Parallax and Header positioning
  window.addEventListener('scroll', handleScroll);
  window.addEventListener('resize', handleScroll);
  
  // Call once immediately to set initial values
  handleScroll();
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
  slides.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
    slide.style.backgroundImage = `linear-gradient(rgba(15, 36, 21, 0.55), rgba(15, 36, 21, 0.85)), url('${src}')`;
    container.appendChild(slide);
  });

  // If only 1 slide, no looping interval needed
  if (slides.length <= 1) return;

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

// ----------------------------------------------------
// FRONTEND PAGE SHARE FEATURE
// ----------------------------------------------------
async function sharePage() {
  const title = 'Gaststätte Naturfreunde Schönheide';
  const text = 'Besucht die Gaststätte Naturfreunde in Schönheide! Gemütliche Gaststätte, Biergarten & Events. Alle Infos & Öffnungszeiten online:';
  const url = getCleanDisplayUrl();

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        openShareModal();
      }
    }
  } else {
    openShareModal();
  }
}

function getCleanDisplayUrl() {
  let url = window.location.href;
  url = url.replace(/xn--gaststtte-naturfreunde-54b\.de/gi, 'gaststaette-naturfreunde.de');
  url = url.replace(/gaststätte-naturfreunde\.de/gi, 'gaststaette-naturfreunde.de');
  url = url.replace(/paulus-digital\.github\.io\/naturfreundeschoenheide/gi, 'gaststaette-naturfreunde.de');
  return url;
}

function openShareModal() {
  const modal = document.getElementById('share-modal');
  if (!modal) return;
  
  const cleanUrl = getCleanDisplayUrl();
  const text = 'Besucht die Gaststätte Naturfreunde in Schönheide! Gemütliche Gaststätte, Biergarten & Events. Alle Infos & Öffnungszeiten online: ' + cleanUrl;
  const modalText = document.getElementById('share-modal-text');
  if (modalText) modalText.textContent = text;

  const waBtn = document.getElementById('share-wa-btn');
  if (waBtn) waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

  const fbBtn = document.getElementById('share-fb-btn');
  if (fbBtn) fbBtn.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(cleanUrl)}`;

  modal.classList.add('active');
}

function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (modal) modal.classList.remove('active');
}

function copyShareLink() {
  const cleanUrl = getCleanDisplayUrl();
  const text = 'Besucht die Gaststätte Naturfreunde in Schönheide! Gemütliche Gaststätte, Biergarten & Events. Alle Infos & Öffnungszeiten online: ' + cleanUrl;
  
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      alert('✅ Link & Text erfolgreich in die Zwischenablage kopiert!');
    });
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('✅ Link & Text erfolgreich in die Zwischenablage kopiert!');
  }
}

// Collapsible Calendar toggle for mobile viewports
function toggleCalendarMobile() {
  const wrapper = document.querySelector('.calendar-collapsible-wrapper');
  const btn = document.getElementById('toggle-calendar-btn');
  if (wrapper && btn) {
    const isOpen = wrapper.classList.toggle('open');
    btn.innerHTML = isOpen ? '▲ Kalender ausblenden' : '📅 Kalender & Belegung anzeigen';
  }
}

// Smart call or scroll handler for phone buttons
function getRawPhone() {
  const p = (appData && appData.contact && appData.contact.phone) ? appData.contact.phone : '0172 4258894';
  return p.replace(/[^0-9+]/g, '') || '01724258894';
}

function handleCallButton(e) {
  const raw = getRawPhone();
  closeMobileMenu();

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 992 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));

  if (isMobile) {
    // Smartphone / Mobile -> Directly open phone app to dial
    window.location.href = `tel:${raw}`;
  } else {
    // Desktop PC -> If clicked on a phone CTA, scroll smoothly to contact section
    if (e && e.preventDefault) e.preventDefault();
    const contactSec = document.getElementById('kontakt');
    if (contactSec) {
      contactSec.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }
}

function handleCallOrScroll(e) {
  handleCallButton(e);
}
