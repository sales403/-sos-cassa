(() => {
  const root = document.documentElement;
  root.classList.add('js');

  const themeToggle = document.getElementById('themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const topbar = document.getElementById('topbar');
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const THEME_KEY = 'sos-site-theme';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function systemTheme() {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 18 ? 'day' : 'night';
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    if (themeMeta) themeMeta.setAttribute('content', theme === 'day' ? '#f4f5f6' : '#080808');
    if (themeToggle) {
      themeToggle.textContent = theme === 'day' ? '☾' : '☀︎';
      themeToggle.setAttribute('aria-label', theme === 'day' ? 'Attiva tema notte' : 'Attiva tema giorno');
    }
  }

  applyTheme(localStorage.getItem(THEME_KEY) || systemTheme());
  themeToggle?.addEventListener('click', () => applyTheme(root.dataset.theme === 'day' ? 'night' : 'day'));

  function toggleMenu(force) {
    if (!mobileMenu) return;
    const open = typeof force === 'boolean' ? force : !mobileMenu.classList.contains('open');
    mobileMenu.classList.toggle('open', open);
    mobileMenu.setAttribute('aria-hidden', String(!open));
    if (menuBtn) menuBtn.textContent = open ? '×' : '☰';
  }

  menuBtn?.addEventListener('click', () => toggleMenu());
  mobileMenu?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggleMenu(false)));
  document.addEventListener('click', e => {
    if (!mobileMenu?.classList.contains('open')) return;
    if (mobileMenu.contains(e.target) || menuBtn?.contains(e.target)) return;
    toggleMenu(false);
  });

  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' }) : null;

  document.querySelectorAll('.reveal').forEach(el => {
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add('in');
  });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = window.innerWidth <= 700 ? 96 : 108;
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - offset,
        behavior: 'smooth'
      });
    });
  });

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ======================================================
  // RADAR GRAFICO: nessuna mappa esterna.
  // I marker sono posizionati in CSS secondo coordinate reali
  // relative a Limidi; il radar illumina il punto quando lo attraversa.
  // ======================================================
  const radarMap = document.getElementById('radarMap');
  const radarSweep = radarMap?.querySelector('.radar-sweep');
  const radarCore = radarMap?.querySelector('.radar-core');
  const cityMarkers = radarMap ? [...radarMap.querySelectorAll('.city-marker')] : [];
  let markerAngles = [];
  let radarVisible = true;
  let radarStart = performance.now();
  const radarDuration = 7200;

  function angularDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function refreshRadarGeometry() {
    if (!radarMap || !radarCore) return;
    const core = radarCore.getBoundingClientRect();
    const cx = core.left + core.width / 2;
    const cy = core.top + core.height / 2;

    markerAngles = cityMarkers.map(marker => {
      const point = marker.querySelector('i') || marker;
      const rect = point.getBoundingClientRect();
      const mx = rect.left + rect.width / 2;
      const my = rect.top + rect.height / 2;
      const dx = mx - cx;
      const dy = my - cy;
      // 0° = nord / alto, senso orario.
      const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      return { marker, angle };
    });
  }

  function radarFrame(now) {
    if (radarSweep && radarVisible) {
      const angle = ((now - radarStart) % radarDuration) / radarDuration * 360;
      radarSweep.style.transform = 'translate(-50%,-50%) rotate(' + angle + 'deg)';
      markerAngles.forEach(({ marker, angle: markerAngle }) => {
        const hit = angularDistance(angle, markerAngle) < 7;
        marker.classList.toggle('radar-hit', hit);
      });
    }
    requestAnimationFrame(radarFrame);
  }

  if (radarMap) {
    requestAnimationFrame(() => {
      refreshRadarGeometry();
      requestAnimationFrame(radarFrame);
    });
    window.addEventListener('resize', refreshRadarGeometry, { passive:true });

    if ('IntersectionObserver' in window) {
      const ro = new IntersectionObserver(entries => {
        radarVisible = entries.some(entry => entry.isIntersecting);
        if (radarVisible) refreshRadarGeometry();
      }, { threshold:0.08 });
      ro.observe(radarMap);
    }
  }

  // ======================================================
  // E-BIKE ON SCROLL: asset trasparente pulito.
  // Nessuna fiamma finta, nessuna deformazione.
  // ======================================================
  const bikeTrack = document.getElementById('bikeTrack');
  const scrollBike = document.getElementById('scrollBike');

  function updateBike() {
    if (!bikeTrack || !scrollBike) return;
    const rect = bikeTrack.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const rawProgress = clamp((vh - rect.top) / (vh + rect.height), 0, 1);

    const bikeW = scrollBike.getBoundingClientRect().width || 320;
    const pad = window.innerWidth <= 700 ? 12 : 24;
    const travelProgress = clamp((rawProgress - 0.12) / 0.72, 0, 1);
    const maxX = Math.max(pad, window.innerWidth - bikeW - pad);
    const x = pad + (maxX - pad) * travelProgress;

    const fadeIn = clamp((rawProgress - 0.08) / 0.08, 0, 1);
    const fadeOut = clamp((0.96 - rawProgress) / 0.08, 0, 1);
    const opacity = Math.min(fadeIn, fadeOut);

    scrollBike.style.transform = 'translate3d(' + x + 'px,0,0)';
    scrollBike.style.opacity = String(opacity);
  }

  let scrollTicking = false;
  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      topbar?.classList.toggle('scrolled', y > 18);
      document.querySelectorAll('.speed-line').forEach((line, i) => {
        line.style.transform = 'translateX(' + ((i % 2 ? -1 : 1) * y * 0.022) + 'px) rotate(-9deg)';
      });
      updateBike();
      scrollTicking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', updateBike, { passive:true });
  onScroll();
})();