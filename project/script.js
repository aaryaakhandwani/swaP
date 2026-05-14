/* ═══════════════════════════════════════════════
   SWAP — Shared JS
═══════════════════════════════════════════════ */

// ── THEME TOGGLE ──
(function () {
  const saved = localStorage.getItem('swap-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('swap-theme', next);
  updateThemeIcons();
}

function updateThemeIcons() {
  const isDark =
    document.documentElement.getAttribute('data-theme') === 'dark';

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = isDark
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

    btn.title = isDark
      ? 'Switch to light mode'
      : 'Switch to dark mode';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeIcons();

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
});

// ── PET TYPE SELECTOR ──
function selectPetType(el, group) {
  const parent = el.closest(group || '.pet-type-selector');

  if (!parent) return;

  parent
    .querySelectorAll('.pet-type-btn')
    .forEach(b => b.classList.remove('active'));

  el.classList.add('active');
}

// ── USER TYPE SELECTOR ──
function selectUserType(el) {
  document
    .querySelectorAll('.user-type-card')
    .forEach(c => c.classList.remove('active'));

  el.classList.add('active');

  const role = el.dataset.role;

  document
    .querySelectorAll('.form-step')
    .forEach(s => s.classList.remove('active'));

  const step = document.getElementById('step-' + role);

  if (step) step.classList.add('active');

  const genericStep = document.getElementById('step-form');

  if (genericStep) genericStep.classList.add('active');
}

// ── SIGNUP FLOW ──
function goSignupStep(stepId) {
  document
    .querySelectorAll('.signup-step')
    .forEach(s => s.classList.remove('active'));

  const target = document.getElementById(stepId);

  if (target) target.classList.add('active');

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

// ── REAL SIGNUP ──
async function handleSignup(e) {
  if (e) e.preventDefault();

  try {
    const card = document.querySelector('.user-type-card.active');

    const role = card
      ? card.dataset.role
      : 'parent';

    const name =
      document.querySelector('#signup-name')?.value?.trim();

    const email =
      document.querySelector('#signup-email')?.value?.trim();

    const password =
      document.querySelector('#signup-password')?.value;

    const res = await fetch('/api/auth/signup', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      credentials: 'include',

      body: JSON.stringify({
        name,
        email,
        password,
        role
      })
    });

    const data = await res.json();

    if (res.ok) {
      swapToast('Account created successfully!', 'success');

      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);

    } else {
      swapToast(data.error || 'Signup failed', 'error');
    }

  } catch (err) {
    console.error(err);
    swapToast('Server error during signup', 'error');
  }
}

// ── REAL LOGIN ──
async function handleLogin(e) {
  if (e) e.preventDefault();

  try {
    const email =
      document.querySelector('#login-email')?.value?.trim();

    const password =
      document.querySelector('#login-password')?.value;

    const res = await fetch('/api/auth/login', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      credentials: 'include',

      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await res.json();

    if (res.ok) {
      swapToast('Logged in successfully!', 'success');

      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);

    } else {
      swapToast(data.error || 'Invalid credentials', 'error');
    }

  } catch (err) {
    console.error(err);
    swapToast('Server error during login', 'error');
  }
}

// ── LOGOUT ──
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });

  } catch (err) {
    console.error(err);
  }

  window.location.href = 'login.html';
}

// ── REAL AUTH CHECK ──
async function requireAuth() {
  try {
    const r = await fetch('/api/auth/me', {
      credentials: 'include'
    });

    const d = await r.json();

    if (!d.user) {
      window.location.href = 'login.html';
      return null;
    }

    return d.user;

  } catch (err) {
    console.error(err);
    window.location.href = 'login.html';
    return null;
  }
}

// ── THEME-AWARE LOGO ──
(function () {
  // Logo switching handled by CSS
})();

// ── GLOBAL TOAST NOTIFICATION ──
(function () {

  var _style = document.createElement('style');

  _style.textContent = [
    '#swap-toast-container{position:fixed;bottom:28px;right:28px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;}',
    '.swap-toast{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:14px;',
    'background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);',
    'box-shadow:0 8px 32px rgba(0,0,0,.13);font-size:13.5px;font-weight:500;color:var(--text,#1a202c);',
    'font-family:"DM Sans",sans-serif;pointer-events:all;',
    'opacity:0;transform:translateY(12px);transition:opacity .28s,transform .28s;max-width:340px;min-width:220px;}',
    '.swap-toast.show{opacity:1;transform:translateY(0);}',
    '.swap-toast-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '.swap-toast.success .swap-toast-icon{background:var(--teal-wash,#e6f7f5);color:var(--teal2,#2d8b80);}',
    '.swap-toast.error .swap-toast-icon{background:#fff0f0;color:#c0392b;}',
    '.swap-toast.info .swap-toast-icon{background:#eff6ff;color:#2563eb;}',
    '.swap-toast-body{flex:1;line-height:1.45;}',
    '.swap-toast-title{font-weight:700;font-size:13px;margin-bottom:1px;}',
    '.swap-toast-msg{font-size:12.5px;color:var(--text2,#4a5568);}'
  ].join('');

  document.head.appendChild(_style);

  var _container = null;

  function _ensureContainer() {
    if (!_container) {
      _container = document.createElement('div');
      _container.id = 'swap-toast-container';
      document.body.appendChild(_container);
    }

    return _container;
  }

  var ICONS = {
    success:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',

    error:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',

    info:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  var TITLES = {
    success: 'Success',
    error: 'Error',
    info: 'Info'
  };

  window.swapToast = function (msg, type, duration) {

    type = type || 'success';
    duration = duration || 4000;

    var c = _ensureContainer();

    var el = document.createElement('div');

    el.className = 'swap-toast ' + type;

    el.innerHTML =
      '<div class="swap-toast-icon">' +
      (ICONS[type] || ICONS.info) +
      '</div>' +

      '<div class="swap-toast-body">' +

      '<div class="swap-toast-title">' +
      (TITLES[type] || 'Notice') +
      '</div>' +

      '<div class="swap-toast-msg">' +
      msg +
      '</div>' +

      '</div>';

    c.appendChild(el);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add('show');
      });
    });

    setTimeout(function () {

      el.classList.remove('show');

      setTimeout(function () {

        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }

      }, 320);

    }, duration);
  };

})();