(() => {
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const THEME_KEY = 'sos-site-theme';

  function systemTheme() {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 18 ? 'day' : 'night';
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    if (themeMeta) themeMeta.setAttribute('content', theme === 'day' ? '#f4f5f6' : '#070707');
    if (themeToggle) {
      themeToggle.textContent = theme === 'day' ? '☾' : '☀︎';
      themeToggle.setAttribute('aria-label', theme === 'day' ? 'Attiva tema notte' : 'Attiva tema giorno');
    }
  }

  applyTheme(localStorage.getItem(THEME_KEY) || systemTheme());

  themeToggle?.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'day' ? 'night' : 'day');
  });

  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }) : null;

  document.querySelectorAll('.reveal').forEach(el => {
    if (io) io.observe(el);
    else el.classList.add('in');
  });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 76;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  document.getElementById('year').textContent = new Date().getFullYear();

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      document.querySelectorAll('.speed-line').forEach((line, i) => {
        line.style.transform = 'translateX(' + ((i % 2 ? -1 : 1) * y * 0.025) + 'px) rotate(-9deg)';
      });
      ticking = false;
    });
  }, { passive: true });
})();