/* PANTaU — account page (log in and sign up) */
(function () {
  'use strict';

  var P = window.PANTaU;
  var $ = function (id) { return document.getElementById(id); };

  var alertBox = $('authAlert');
  var tabs = { login: $('tab-login'), signup: $('tab-signup') };
  var panels = { login: $('panel-login'), signup: $('panel-signup') };
  var titles = { login: 'PANTaU — Log In', signup: 'PANTaU — Sign Up' };

  /* ---------- Tabs ---------- */
  function showTab(name) {
    Object.keys(tabs).forEach(function (key) {
      var on = key === name;
      tabs[key].setAttribute('aria-selected', String(on));
      tabs[key].tabIndex = on ? 0 : -1;
      panels[key].hidden = !on;
    });
    document.title = titles[name];
    P.clearAlert(alertBox);
  }

  Object.keys(tabs).forEach(function (key) {
    tabs[key].addEventListener('click', function () { showTab(key); });
    tabs[key].addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var other = key === 'login' ? 'signup' : 'login';
        showTab(other);
        tabs[other].focus();
      }
    });
  });

  // The home page sends "Sign Up" visitors here with #signup.
  if (location.hash === '#signup') showTab('signup');
  window.addEventListener('hashchange', function () {
    showTab(location.hash === '#signup' ? 'signup' : 'login');
  });

  /* ---------- Already logged in? Go to the dashboard ---------- */
  P.api.me().then(function (me) {
    if (me && me.role === 'user') location.replace('dashboard.html');
  }).catch(function () { /* not logged in, stay here */ });

  /* ---------- IC inputs: only digits and dashes ---------- */
  ['loginIc', 'signupIc'].forEach(function (id) {
    $(id).addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/[^\d-]/g, '');
    });
  });
  ['loginPin', 'signupPin', 'signupPin2'].forEach(function (id) {
    $(id).addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  });

  // Preview of the age and gender that will be worked out from the IC
  $('signupIc').addEventListener('input', function () {
    var digits = P.cleanIC($('signupIc').value);
    var preview = $('icPreview');
    if (digits.length < 12) { preview.textContent = ''; return; }
    var info = P.parseIC(digits);
    preview.textContent = info
      ? 'Detected from IC: ' + info.age + ' years old, ' + info.gender + '.'
      : 'This IC number does not look valid.';
  });

  /* ---------- Log in ---------- */
  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = e.target;
    P.clearFieldErrors(form);
    P.clearAlert(alertBox);

    var ic = P.cleanIC($('loginIc').value);
    var pin = $('loginPin').value;
    var ok = true;

    if (ic.length !== 12) { P.setFieldError($('loginIc'), 'Enter your 12-digit IC number.'); ok = false; }
    if (!/^\d{4,6}$/.test(pin)) { P.setFieldError($('loginPin'), 'Enter your 4 to 6 digit PIN.'); ok = false; }
    if (!ok) { form.querySelector('[aria-invalid="true"]').focus(); return; }

    var btn = $('loginBtn');
    P.setBusy(btn, true, 'Logging in…');
    try {
      var res = await P.api.login(ic, pin);
      if (res.role === 'admin') {
        P.showAlert(alertBox, 'info', 'Admin account detected. The admin dashboard will be added in a later step.');
      } else {
        location.href = 'dashboard.html';
        return;
      }
    } catch (err) {
      P.showAlert(alertBox, 'danger', P.errorMessage(err));
    }
    P.setBusy(btn, false);
  });

  /* ---------- Sign up ---------- */
  $('signupForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = e.target;
    P.clearFieldErrors(form);
    P.clearAlert(alertBox);

    var name = $('signupName').value.trim().replace(/\s+/g, ' ');
    var ic = P.cleanIC($('signupIc').value);
    var pin = $('signupPin').value;
    var pin2 = $('signupPin2').value;
    var ok = true;

    if (name.length < 2) { P.setFieldError($('signupName'), 'Enter your full name.'); ok = false; }
    if (ic.length !== 12) {
      P.setFieldError($('signupIc'), 'Enter a 12-digit IC number.');
      ok = false;
    } else if (!P.parseIC(ic)) {
      P.setFieldError($('signupIc'), 'This IC number does not look valid. Please check it.');
      ok = false;
    }
    if (!/^\d{4,6}$/.test(pin)) { P.setFieldError($('signupPin'), 'PIN must be 4 to 6 digits.'); ok = false; }
    else if (pin !== pin2) { P.setFieldError($('signupPin2'), 'The two PINs do not match.'); ok = false; }
    if (!ok) { form.querySelector('[aria-invalid="true"]').focus(); return; }

    var btn = $('signupBtn');
    P.setBusy(btn, true, 'Creating account…');
    try {
      await P.api.signup(name, ic, pin);
      location.href = 'dashboard.html'; // the new account is already logged in
      return;
    } catch (err) {
      if (err.code === 'already_registered') {
        form.reset();
        $('icPreview').textContent = '';
        showTab('login');
        $('loginIc').value = ic;
        $('loginPin').focus();
        P.showAlert(alertBox, 'warning', 'You have registered before. Please log in with your IC number and PIN.', { title: 'Already registered' });
      } else {
        P.showAlert(alertBox, 'danger', P.errorMessage(err));
      }
    }
    P.setBusy(btn, false);
  });
})();
