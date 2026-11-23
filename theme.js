/* PANTaU — light / dark theme, remembered in this browser.
   Load this in the <head> so the right theme is applied before the page is drawn. */
(function () {
  'use strict';

  var KEY = 'pantau.theme';
  var root = document.documentElement;

  function saved() {
    try {
      var value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (e) {
      return null;
    }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
  }

  function refreshButtons() {
    var dark = root.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-pressed', String(dark));
      btn.setAttribute('aria-label', label);
      btn.title = label;
    });
  }

  // First visit: dark. After that: whatever was saved last.
  apply(saved() || 'dark');

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem(KEY, next); } catch (e) { /* storage not available */ }
        refreshButtons();
      });
    });
    refreshButtons();
  });

  // Keep other open tabs in step.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      apply(e.newValue);
      refreshButtons();
    }
  });
})();
