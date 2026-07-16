// Global data state
let appData = {};

// GitHub API and Raw URL definitions
const GITHUB_API_URL = 'https://api.github.com/repos/paulus-digital/naturfreundeschoenheide/contents/data.json?ref=data-sync';
const RAW_DATA_URL = 'https://raw.githubusercontent.com/paulus-digital/naturfreundeschoenheide/data-sync/data.json';

// Setup active tab polling
let pollInterval = null;
let slideshowInterval = null;

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

    // Check if there is locally saved guestbook entries in localStorage for instant testing
    const localReviews = JSON.parse(localStorage.getItem('local_guestbook_reviews') || '[]');
    if (localReviews.length > 0) {
      appData.guestbook = [...(appData.guestbook || []), ...localReviews];
    }

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

  // 1. Live Banner
  const liveBanner = document.getElementById('live-banner');
  const bannerText = document.getElementById('banner-text');
  if (appData.banner && appData.banner.visible && appData.banner.text.trim()) {
    bannerText.textContent = appData.banner.text;
    liveBanner.classList.remove('hidden');
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
  renderPlanner();

  // 5. Gallery
  renderGallery();

  // 6. Guestbook Reviews
  renderGuestbook();

  // 7. Contact Details & Forms
  renderContact();
}

// Helper: Translate Day Number to German Day Name
const GERMAN_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function renderOpeningHours() {
  const hoursList = document.getElementById('hours-list');
  const todayPreview = document.getElementById('today-hours-preview');
  if (!hoursList || !appData.openingHours) return;

  hoursList.innerHTML = '';
  
  // Get current day name in German
  const currentDayIndex = new Date().getDay();
  const currentDayGerman = GERMAN_DAYS[currentDayIndex];
  
  let todayHoursString = 'Heute: Ruhetag';

  appData.openingHours.forEach(item => {
    const li = document.createElement('li');
    li.className = 'hours-row';
    
    const isToday = item.day.toLowerCase() === currentDayGerman.toLowerCase();
    if (isToday) {
      li.classList.add('current-day');
      todayHoursString = `Heute (${item.day}): ${item.hours}`;
    }
    
    li.innerHTML = `
      <span>${item.day}</span>
      <span>${item.hours}</span>
    `;
    hoursList.appendChild(li);
  });

  if (todayPreview) {
    todayPreview.textContent = todayHoursString;
  }
}

function renderPlanner() {
  const plannerList = document.getElementById('planner-list');
  if (!plannerList) return;

  plannerList.innerHTML = '';

  if (!appData.planner || appData.planner.length === 0) {
    plannerList.innerHTML = '<p class="text-muted text-center" style="grid-column: 1/-1; padding: 20px;">Zur Zeit liegen keine Termine oder Belegungspläne vor.</p>';
    return;
  }

  // Sort planner items by date (earliest first)
  const sortedPlanner = [...appData.planner].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Translate status keys to display badges
  const statusTranslations = {
    'open': 'Geöffnet',
    'booked': 'Ausgebucht',
    'closed': 'Geschlossen',
    'holiday': 'Urlaub/Feiertag',
    'reservation': 'Reservierung möglich',
    'event': 'Event'
  };

  sortedPlanner.forEach(item => {
    const dateObj = new Date(item.date);
    const day = dateObj.getDate().toString().padStart(2, '0');
    const month = dateObj.toLocaleDateString('de-DE', { month: 'short' });
    
    const statusClass = `status-${item.status}`;
    const badgeText = statusTranslations[item.status] || item.status;

    const plannerItem = document.createElement('div');
    plannerItem.className = `planner-item ${statusClass}`;
    plannerItem.innerHTML = `
      <div class="planner-date">
        <div class="day-num">${day}</div>
        <div class="month-name">${month}</div>
      </div>
      <div class="planner-info">
        <div class="planner-label">${item.label}</div>
        <span class="planner-badge">${badgeText}</span>
      </div>
    `;
    plannerList.appendChild(plannerItem);
  });
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

  // Set Web3Forms Access Key
  const web3formsInput = document.getElementById('web3forms-key');
  if (web3formsInput && c.web3formsKey) {
    web3formsInput.value = c.web3formsKey;
  }
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
    
    // Save to local storage mock review database for immediate visual feedback
    const localReviews = JSON.parse(localStorage.getItem('local_guestbook_reviews') || '[]');
    const newMockReview = {
      id: `local_${Date.now()}`,
      name: name,
      rating: rating,
      comment: comment,
      date: new Date().toISOString().split('T')[0],
      approved: true // Auto approve locally for demo/instant gratification
    };
    localReviews.push(newMockReview);
    localStorage.setItem('local_guestbook_reviews', JSON.stringify(localReviews));

    // Display feedback
    feedback.style.display = 'block';
    feedback.textContent = 'Vielen Dank! Ihr Eintrag wurde gespeichert und wird direkt auf diesem Gerät angezeigt. Bei aktiver Web3Forms-Anbindung erhält der Inhaber eine E-Mail.';
    
    // Trigger actual form submit via Fetch so page doesn't redirect
    const formData = new FormData(form);
    
    // If Web3Forms API Key is set and isn't placeholder, submit it
    const apiKey = document.getElementById('web3forms-key').value;
    if (apiKey && apiKey !== 'YOUR_WEB3FORMS_ACCESS_KEY_HERE') {
      try {
        await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          body: formData
        });
      } catch (err) {
        console.error('Web3Forms submit error:', err);
      }
    }

    // Refresh guestbook in current view
    appData.guestbook.push(newMockReview);
    renderGuestbook();

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
  slides.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
    slide.style.backgroundImage = `linear-gradient(rgba(15, 36, 21, 0.55), rgba(15, 36, 21, 0.85)), url('${src}')`;
    container.appendChild(slide);
  });

  // If only 1 slide, no animation needed
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
