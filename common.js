/* PANTaU — shared helpers: API calls, IC utilities, Malaysia-time formatting, alerts */
(function () {
  'use strict';

  var TIMEZONE = 'Asia/Kuala_Lumpur';
  var PAGES = { index: 'index.html', dashboard: 'dashboard.html' };

  var ERRORS = {
    invalid_credentials: 'IC number or PIN is incorrect.',
    already_registered: 'This IC number is already registered. Please log in instead.',
    invalid_input: 'Some details are not valid. Please check and try again.',
    invalid_ic: 'This IC number does not look valid.',
    invalid_reading: 'The reading values are not valid. Please check and try again.',
    unauthorized: 'Your session has expired. Please log in again.',
    too_many_attempts: 'Too many wrong attempts. Please wait 15 minutes and try again.',
    forbidden: 'This request was blocked. Please reload the page and try again.',
    database_error: 'There is a problem with the database. Please try again later.',
    server_error: 'There is a problem with the server. Please try again later.',
    network: 'Cannot reach the server. Please check your connection and try again.',
    request_failed: 'Something went wrong. Please try again.'
  };

  /* ---------- Page / offline handling ---------- */
  function currentPage() {
    var name = location.pathname.split('/').pop() || 'index';
    return name.replace(/\.html$/, '');
  }

  function goOffline() {
    if (currentPage() === 'offline') return;
    var from = Object.prototype.hasOwnProperty.call(PAGES, currentPage()) ? PAGES[currentPage()] : 'index.html';
    location.href = 'offline.html?from=' + encodeURIComponent(from);
  }

  window.addEventListener('offline', goOffline);

  /* ---------- API ---------- */
  function makeError(code, status) {
    var e = new Error(code);
    e.code = code;
    e.status = status;
    return e;
  }

  async function request(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    var res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      if (!navigator.onLine) goOffline();
      throw makeError('network', 0);
    }

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      var code = (data && data.error) || (res.status >= 500 ? 'server_error' : 'request_failed');
      throw makeError(code, res.status);
    }
    return data || {};
  }

  var api = {
    me: function () { return request('/api/me'); },
    login: function (ic, pin) { return request('/api/login', { method: 'POST', body: { ic: ic, pin: pin } }); },
    signup: function (name, ic, pin) { return request('/api/signup', { method: 'POST', body: { name: name, ic: ic, pin: pin } }); },
    logout: function () { return request('/api/logout', { method: 'POST', body: {} }); },
    getReadings: function () { return request('/api/readings'); },
    addReading: function (reading) { return request('/api/readings', { method: 'POST', body: reading }); }
  };

  function errorMessage(err) {
    return ERRORS[err && err.code] || ERRORS.request_failed;
  }

  /* ---------- IC helpers (stored without dashes) ---------- */
  function cleanIC(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatIC(value) {
    var d = cleanIC(value);
    if (d.length !== 12) return d;
    return d.slice(0, 6) + '-' + d.slice(6, 8) + '-' + d.slice(8);
  }

  // Returns { age, gender } or null when the IC is not a valid 12-digit Malaysian IC.
  // Century rule: a two-digit year later than the current year is read as 19xx, otherwise 20xx.
  function parseIC(value) {
    var d = cleanIC(value);
    if (d.length !== 12) return null;

    var yy = Number(d.slice(0, 2));
    var mm = Number(d.slice(2, 4));
    var dd = Number(d.slice(4, 6));
    var now = new Date();
    var year = yy > now.getFullYear() % 100 ? 1900 + yy : 2000 + yy;

    var dob = new Date(Date.UTC(year, mm - 1, dd));
    if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) return null;

    var age = now.getFullYear() - year;
    var monthDiff = now.getMonth() - (mm - 1);
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dd)) age -= 1;
    if (age < 0) return null;

    return { age: age, gender: Number(d.charAt(11)) % 2 === 1 ? 'Male' : 'Female' };
  }

  /* ---------- Date / time (database stores UTC, shown in Malaysia time) ---------- */
  function toDate(value) {
    if (!value) return null;
    var v = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) {
      v = v.replace(' ', 'T') + 'Z';
    } else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(v)) {
      v += 'Z';
    }
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(d) {
    return d.toLocaleDateString('en-GB', { timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatTime(d) {
    return d.toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true });
  }

  /* ---------- UI helpers ---------- */
  var ALERT_TITLES = { success: 'Success', danger: 'Something went wrong', warning: 'Please check', info: 'Note' };

  function showAlert(container, type, message, options) {
    options = options || {};
    container.replaceChildren();
    var box = document.createElement('div');
    box.className = 'alert alert--' + type;
    box.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    var title = document.createElement('strong');
    title.textContent = options.title || ALERT_TITLES[type] || '';
    var text = document.createElement('span');
    text.textContent = message;
    box.append(title, text);
    container.append(box);
    if (options.autoHide) {
      setTimeout(function () { if (box.isConnected) box.remove(); }, 6000);
    }
  }

  function clearAlert(container) {
    container.replaceChildren();
  }

  function setFieldError(input, message) {
    var target = document.getElementById(input.id + '-error');
    if (target) {
      target.textContent = message;
      target.hidden = false;
    }
    input.setAttribute('aria-invalid', 'true');
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field__error').forEach(function (el) {
      el.textContent = '';
      el.hidden = true;
    });
    form.querySelectorAll('[aria-invalid]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function setBusy(button, busy, text) {
    if (busy) {
      button.dataset.html = button.innerHTML;
      button.textContent = text || 'Please wait…';
      button.disabled = true;
    } else {
      if (button.dataset.html) button.innerHTML = button.dataset.html;
      button.disabled = false;
    }
  }

  // Show / hide buttons for PIN fields: <button data-toggle="inputId another-inputId">
  document.querySelectorAll('[data-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var ids = btn.getAttribute('data-toggle').split(' ');
      var show = document.getElementById(ids[0]).type === 'password';
      ids.forEach(function (id) {
        var input = document.getElementById(id);
        if (input) input.type = show ? 'text' : 'password';
      });
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide PIN' : 'Show PIN');
    });
  });

  window.PANTaU = {
    TIMEZONE: TIMEZONE,
    api: api,
    errorMessage: errorMessage,
    cleanIC: cleanIC,
    formatIC: formatIC,
    parseIC: parseIC,
    toDate: toDate,
    formatDate: formatDate,
    formatTime: formatTime,
    showAlert: showAlert,
    clearAlert: clearAlert,
    setFieldError: setFieldError,
    clearFieldErrors: clearFieldErrors,
    setBusy: setBusy
  };
})();
