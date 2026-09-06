(() => {
  const root = document.documentElement;
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

  document.querySelectorAll('.reveal').forEach(el => revealObserver ? revealObserver.observe(el) : el.classList.add('in'));

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = window.innerWidth <= 700 ? 66 : 76;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
    });
  });

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ---------- REAL MAP + RADAR ----------
  const LIMIDI = [44.76182, 10.92462];
  const places = [
    { id:'carpi', name:'CARPI', lat:44.78360, lon:10.88550 },
    { id:'limidi', name:'LIMIDI', lat:44.76182, lon:10.92462, main:true },
    { id:'soliera', name:'SOLIERA', lat:44.73890, lon:10.92730 },
    { id:'sozzigalli', name:'SOZZIGALLI', lat:44.74970, lon:10.97241 },
    { id:'cortile', name:'CORTILE', lat:44.79860, lon:10.97030 }
  ];

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  let radarElements = [];
  function initMap() {
    const el = document.getElementById('coverageMap');
    if (!el || !window.L) return;
    try {
      const map = L.map(el, { zoomControl:true, scrollWheelZoom:false, attributionControl:true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:'&copy; OpenStreetMap'
      }).addTo(map);

      const circleStyle = (color, opacity, fillOpacity, dashArray) => ({
        color, weight:2, opacity, fillColor:color, fillOpacity, dashArray
      });

      const c8 = L.circle(LIMIDI, { radius:8000, ...circleStyle('#8c7500',.55,.018,'9 10') }).addTo(map);
      L.circle(LIMIDI, { radius:5000, ...circleStyle('#d2ac00',.65,.022,'7 8') }).addTo(map);
      L.circle(LIMIDI, { radius:3000, ...circleStyle('#ffd000',.85,.028,'5 6') }).addTo(map);

      places.forEach(p => {
        const km = haversine(LIMIDI[0], LIMIDI[1], p.lat, p.lon);
        const html = '<div class="sos-map-marker '+(p.main?'main ':'')+'marker-'+p.id+'"><i></i><b>'+p.name+(p.main?'':' · '+km.toFixed(1)+' km')+'</b></div>';
        const icon = L.divIcon({ className:'sos-marker-wrap', html, iconSize:[145,30], iconAnchor:[12,15] });
        L.marker([p.lat,p.lon], { icon, interactive:false }).addTo(map);
      });

      map.fitBounds(c8.getBounds(), { padding:[18,18] });
      setTimeout(() => map.invalidateSize(), 300);

      const refreshRadarEls = () => {
        radarElements = places.map(p => document.querySelector('.marker-'+p.id)).filter(Boolean);
      };
      setTimeout(refreshRadarEls, 500);

      let hitIndex = 0;
      setInterval(() => {
        if (!radarElements.length) refreshRadarEls();
        radarElements.forEach(elm => elm.classList.remove('radar-hit'));
        const hit = radarElements[hitIndex % radarElements.length];
        if (hit) {
          hit.classList.add('radar-hit');
          setTimeout(() => hit.classList.remove('radar-hit'), 800);
        }
        hitIndex++;
      }, 1250);
    } catch (err) {
      console.warn('Mappa SOS Rider non disponibile', err);
      el.innerHTML = '<div style="height:100%;display:grid;place-items:center;padding:30px;text-align:center;color:#ffd000;font-weight:900">Mappa momentaneamente non disponibile.<br>Base SOS Rider: Limidi.</div>';
    }
  }

  if (document.readyState === 'complete') initMap();
  else window.addEventListener('load', initMap, { once:true });

  // ---------- SCROLL E-BIKE ----------
  const bikeTrack = document.getElementById('bikeTrack');
  const scrollBike = document.getElementById('scrollBike');
  const speedLines = [...document.querySelectorAll('.bike-speed')];

  function updateBike() {
    if (!bikeTrack || !scrollBike) return;
    const rect = bikeTrack.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const progress = clamp((vh - rect.top) / (vh + rect.height), 0, 1);
    const bikeW = scrollBike.getBoundingClientRect().width || 360;
    const travel = window.innerWidth + bikeW * 1.25;
    const x = -bikeW * 1.08 + travel * progress;
    const visible = progress > .03 && progress < .98;
    scrollBike.style.transform = 'translate3d('+x+'px,'+(Math.sin(progress*Math.PI*3)*-4)+'px,0) rotate('+(Math.sin(progress*Math.PI*2)*1.2)+'deg)';
    scrollBike.style.opacity = visible ? '1' : '0';
    speedLines.forEach((line,i) => {
      const offset = x - 110 - i*55;
      line.style.transform = 'translateX('+offset+'px)';
      line.style.opacity = visible ? String(.22 + progress*.42) : '0';
    });
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      topbar?.classList.toggle('scrolled', y > 18);
      document.querySelectorAll('.speed-line').forEach((line, i) => {
        line.style.transform = 'translateX(' + ((i % 2 ? -1 : 1) * y * 0.025) + 'px) rotate(-9deg)';
      });
      updateBike();
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', updateBike, { passive:true });
  onScroll();
})();