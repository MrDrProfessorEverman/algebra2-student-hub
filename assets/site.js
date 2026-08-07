// Algebra II Student Hub - sidebar hamburger collapse/expand.
// Persisted across pages via localStorage (shared across both tracks - it's
// a UI preference, not track-specific). Defaults to collapsed on small
// screens the first time a visitor shows up, since the full panel eats a
// lot of vertical space above the actual content once it's stacked on
// mobile.
(function () {
  var KEY = 'a2hub_sidebar_collapsed';

  function apply(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
  }

  var stored = localStorage.getItem(KEY);
  var collapsed = stored === null ? window.innerWidth <= 860 : stored === '1';
  apply(collapsed);

  function setCollapsed(value) {
    collapsed = value;
    apply(collapsed);
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  }

  var hamburger = document.getElementById('sidebarHamburger');
  if (hamburger) {
    hamburger.addEventListener('click', function () {
      setCollapsed(!collapsed);
    });
  }

  // While collapsed to icon-only, clicking a unit row should re-expand the
  // whole sidebar instead of toggling that unit's own lesson checklist.
  var rows = document.querySelectorAll('.unit-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].addEventListener('click', function (e) {
      if (collapsed) {
        e.preventDefault();
        setCollapsed(false);
      }
    });
  }
})();

// Study Hall - "Copy Study Prompt" buttons. Tries the modern clipboard API
// first; falls back to a hidden-textarea + execCommand trick for browsers/
// contexts where that's unavailable (e.g. viewing over plain file://
// during testing - the real GitHub Pages site is https, where the modern
// API works fine).
(function () {
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more we can do */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  var buttons = document.querySelectorAll('.copy-prompt-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      var btn = this;
      var text = btn.getAttribute('data-prompt') || '';
      copyText(text).then(function () {
        var original = btn.getAttribute('data-label') || btn.textContent;
        btn.setAttribute('data-label', original);
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove('copied');
        }, 1800);
      });
    });
  }
})();
