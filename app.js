(() => {
  const config = window.FAB_CONFIG || {};
  const body = document.body;
  const header = document.querySelector('.site-header');
  const navToggle = document.querySelector('.nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  const setNav = (open) => {
    if (!navToggle || !mobileNav) return;
    navToggle.setAttribute('aria-expanded', String(open));
    mobileNav.classList.toggle('open', open);
    body.classList.toggle('nav-open', open);
  };
  navToggle?.addEventListener('click', () => setNav(navToggle.getAttribute('aria-expanded') !== 'true'));
  mobileNav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setNav(false)));
  addEventListener('keydown', (event) => { if (event.key === 'Escape') setNav(false); });

  const updateHeader = () => header?.classList.toggle('scrolled', scrollY > 12);
  updateHeader();
  addEventListener('scroll', updateHeader, { passive: true });

  const normalisePageName = (pathname) => {
  let pageName = pathname.split('/').filter(Boolean).pop() || 'index.html';

  if (!pageName.includes('.')) {
    pageName = `${pageName}.html`;
  }

  return pageName.toLowerCase();
};

const currentPage = normalisePageName(window.location.pathname);

body.classList.add(
  `page-${currentPage.replace(/\.html$/, '') || 'index'}`
);

document.querySelectorAll('[data-nav]').forEach((link) => {
  const linkUrl = new URL(link.getAttribute('href'), window.location.href);
  const linkPage = normalisePageName(linkUrl.pathname);
  const isCurrentPage = linkPage === currentPage;

  link.classList.toggle('active', isCurrentPage);

  if (isCurrentPage) {
    link.setAttribute('aria-current', 'page');
  } else {
    link.removeAttribute('aria-current');
  }
});
  document.querySelectorAll('[data-current-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });

  const priceLabel = (service, format = 'long') => {
    if (!service) return '';
    if (service.quoteOnly) return format === 'short' ? 'Quote' : 'Tailored quote';
    if (service.fixed) return `From £${service.fixed}`;
    if (service.hourly) return format === 'short' ? `£${service.hourly}/hr` : `£${service.hourly} per hour`;
    return '';
  };
  document.querySelectorAll('[data-price]').forEach((node) => {
    const service = config.rates?.[node.dataset.price];
    const label = priceLabel(service, node.dataset.priceFormat || 'long');
    if (label) node.textContent = label;
  });

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries, current) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          current.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px' });
    reveals.forEach((element) => observer.observe(element));
  } else {
    reveals.forEach((element) => element.classList.add('visible'));
  }

  const normalisePostcode = (value) => String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const outwardCode = (postcode) => (window.FAB_AREA?.outward(postcode) || normalisePostcode(postcode).replace(/\s.*/, ''));
  const isCovered = (value) => window.FAB_AREA?.covered(value) ?? false;

  document.querySelectorAll('[data-postcode-check]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = form.querySelector('input');
      const result = form.querySelector('[data-postcode-result]');
      const value = input?.value.trim() || '';
      if (!value) return;
      if (isCovered(value)) {
        result.textContent = 'Good news — this address is inside a current service area.';
        result.className = 'postcode-result success';
      } else {
        result.textContent = "We’re not here yet, but we’ll expand soon.";
        result.className = 'postcode-result warning';
      }
    });
  });

  document.querySelectorAll('[data-map-area]').forEach((button) => {
    button.addEventListener('click', () => {
      const area = button.dataset.mapArea;
      document.querySelectorAll('[data-map-area]').forEach((item) => item.classList.toggle('active', item === button));
      if (map) map.src = `https://www.google.com/maps?q=${encodeURIComponent(`${area}, UK`)}&z=10&output=embed`;
      if (mapLabel) mapLabel.textContent = area;
    });
  });

  const showToast = (title, message) => {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.innerHTML = '<i class="fa-solid fa-circle-check"></i><div><strong></strong><span></span></div>';
      document.body.appendChild(toast);
    }
    toast.querySelector('strong').textContent = title;
    toast.querySelector('span').textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__fabToastTimer);
    window.__fabToastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
  };
  window.FAB_showToast = showToast;
})();

// Drawer close control and backdrop behaviour.
document.querySelector('[data-nav-close]')?.addEventListener('click', () => {
  document.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false');
  document.querySelector('.mobile-nav')?.classList.remove('open');
  document.body.classList.remove('nav-open');
});
document.addEventListener('click', (event) => {
  if (!document.body.classList.contains('nav-open')) return;
  const drawer = document.querySelector('.mobile-nav');
  const toggle = document.querySelector('.nav-toggle');
  if (drawer && !drawer.contains(event.target) && toggle && !toggle.contains(event.target)) {
    toggle.setAttribute('aria-expanded', 'false');
    drawer.classList.remove('open');
    document.body.classList.remove('nav-open');
  }
});


document.querySelectorAll('.form-status').forEach(node=>{node.setAttribute('role','status');node.setAttribute('aria-live','polite');});
document.querySelectorAll('[role="dialog"]').forEach(dialog=>{dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const items=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];if(!items.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});});

// Apply public website settings managed from the admin dashboard.
(async () => {
  try {
    const service = await import('./firebase-service.js');
    if (!service.isFirebaseConfigured) return;
    const [siteContent, serviceCatalog] = await Promise.all([
      service.getAdminDocument('settings', 'siteContent'),
      service.getAdminDocument('settings', 'serviceCatalog')
    ]);

    if (siteContent) {
      window.FAB_CONFIG = { ...(window.FAB_CONFIG || {}), ...siteContent };
      document.querySelectorAll('a[href^="tel:"]').forEach(link => {
        if (siteContent.phoneDisplay) link.textContent = siteContent.phoneDisplay;
        if (siteContent.phoneInternational) link.href = `tel:${siteContent.phoneInternational}`;
      });
      document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
        if (siteContent.email) { link.textContent = siteContent.email; link.href = `mailto:${siteContent.email}`; }
      });
      document.querySelectorAll('[data-business-name]').forEach(node => { if (siteContent.businessName) node.textContent = siteContent.businessName; });
      document.querySelectorAll('[data-opening-hours]').forEach(node => { if (siteContent.openingHours) node.textContent = siteContent.openingHours; });

      const announcement = siteContent.announcement;
      if (announcement?.enabled && announcement.message && !document.querySelector('.site-admin-announcement')) {
        const bar = document.createElement('div');
        bar.className = 'site-admin-announcement';
        bar.innerHTML = `<span>${String(announcement.message).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>${announcement.linkUrl ? `<a href="${announcement.linkUrl}">${announcement.linkText || 'Learn more'}</a>` : ''}<button type="button" aria-label="Close">×</button>`;
        document.body.prepend(bar);
        bar.querySelector('button').addEventListener('click', () => bar.remove());
      }
    }

    if (Array.isArray(serviceCatalog?.services)) {
      const rates = Object.fromEntries(serviceCatalog.services.filter(item => item.active !== false).map(item => [item.id, item]));
      window.FAB_CONFIG.rates = rates;
      document.querySelectorAll('[data-price]').forEach(node => {
        const item = rates[node.dataset.price];
        if (!item) return;
        node.textContent = item.pricingType === 'quote' || item.quoteOnly ? 'Tailored quote' : item.pricingType === 'fixed' || item.fixed ? `From £${Number(item.price ?? item.fixed).toFixed(0)}` : `£${Number(item.price ?? item.hourly).toFixed(0)} per hour`;
      });
    }
  } catch (error) {
    console.warn('Live admin-managed website settings could not be applied.', error);
  }
})();
