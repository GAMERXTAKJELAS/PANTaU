/* PANTaU — patient dashboard */
(function () {
  'use strict';

  var P = window.PANTaU;
  var $ = function (id) { return document.getElementById(id); };

  var alertBox = $('alertArea');
  var formAlert = $('formAlert');
  var form = $('readingForm');
  var devicesBox = $('devices');
  var banner = $('draftBanner');
  var navButtons = document.querySelectorAll('[data-view]');
  var views = { dashboard: $('view-dashboard'), history: $('view-history') };
  var titles = {
    dashboard: ['Dashboard', 'Add a new reading and see your latest values.'],
    history: ['History', 'All readings recorded so far, newest first.']
  };

  var DEVICE_NAMES = { oximeter: 'Oximeter', bp: 'Blood Pressure Monitor', glucose: 'Blood Glucose Monitor' };
  var COUNTDOWN_SECONDS = 60;
  var LATE_SECONDS = 120;
  var DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
  var REFRESH_MS = 60 * 1000;

  // Wide limits that only catch typing mistakes. Not medical thresholds.
  var BP_LIMITS = { systolic: [50, 300], diastolic: [30, 200], bpm: [20, 250] };
  var SPO2_LIMITS = [50, 100];
  var PULSE_LIMITS = [20, 250];

  var me = null;
  var readings = [];
  var loadFailed = false;
  var loading = false;
  var reloadAgain = false;
  var lastLoaded = 0;
  var draft = null;

  /* ---------- Errors ---------- */
  function handleError(err, container) {
    if (err && err.status === 401) { location.replace('account.html'); return; }
    P.showAlert(container || alertBox, 'danger', P.errorMessage(err));
  }

  /* ---------- Views ---------- */
  function showView(name) {
    if (!views[name]) name = 'dashboard';
    Object.keys(views).forEach(function (key) { views[key].hidden = key !== name; });
    navButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-view') === name;
      btn.classList.toggle('is-active', on);
      if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    $('pageTitle').textContent = titles[name][0];
    $('pageSub').textContent = titles[name][1];
    if (location.hash !== '#' + name) window.history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  }

  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.getAttribute('data-view')); });
  });
  window.addEventListener('hashchange', function () { showView(location.hash.slice(1)); });

  /* ---------- Patient ---------- */
  function renderPatient() {
    var info = P.parseIC(me.ic) || {};
    var age = me.age != null ? me.age : info.age;
    var gender = me.gender || info.gender;
    var ageText = age != null ? age + ' years' : '—';

    $('ptName').textContent = me.name;
    $('ptIc').textContent = P.formatIC(me.ic);
    $('ptAge').textContent = ageText;
    $('ptGender').textContent = gender || '—';

    $('printName').textContent = me.name;
    $('printIc').textContent = P.formatIC(me.ic);
    $('printAgeGender').textContent = ageText + ' / ' + (gender || '—');

    titles.dashboard[1] = 'Hello, ' + me.name + '. ' + titles.dashboard[1];
    $('pageSub').textContent = titles.dashboard[1];
  }

  /* ---------- Draft (saved for now in this browser only) ---------- */
  function draftKey() { return 'pantau.draft.v1.' + me.id; }

  function readDraft() {
    try {
      var raw = localStorage.getItem(draftKey());
      if (!raw) return null;
      var d = JSON.parse(raw);
      var first = d && d.firstSavedAt ? new Date(d.firstSavedAt).getTime() : NaN;
      if (!d || d.v !== 1 || isNaN(first) || Date.now() - first > DRAFT_TTL_MS) {
        localStorage.removeItem(draftKey());
        return null;
      }
      return d;
    } catch (e) {
      return null;
    }
  }

  function writeDraft(d) {
    try {
      localStorage.setItem(draftKey(), JSON.stringify(d));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ }
    draft = null;
  }

  function showDraftBanner() {
    if (!draft) { banner.hidden = true; updateFormState(); return; }
    var d = P.toDate(draft.firstSavedAt);
    var when = d ? ' (saved ' + P.formatDate(d) + ', ' + P.formatTime(d) + ')' : '';
    $('draftText').textContent = 'You have an unfinished reading saved on this device' + when + '. Continue it or discard it before adding a new reading.';
    banner.hidden = false;
    updateFormState();
  }

  /* ---------- Device cards ---------- */
  function openDevices() {
    return Array.prototype.map.call(devicesBox.querySelectorAll('[data-device]'), function (el) {
      return el.getAttribute('data-device');
    });
  }

  function updateFormState() {
    var count = openDevices().length;
    $('devicesEmpty').hidden = count > 0;
    $('noteGroup').hidden = count === 0;
    $('timeHint').hidden = count === 0;
    $('formActions').hidden = count === 0;
    $('addDeviceBtn').disabled = count === 3 || !banner.hidden;

    document.querySelectorAll('[data-device-option]').forEach(function (btn) {
      btn.disabled = openDevices().indexOf(btn.getAttribute('data-device-option')) !== -1;
    });
    if (count === 3 || !banner.hidden) setMenu(false);
  }

  function setMenu(open) {
    $('deviceMenu').hidden = !open;
    $('addDeviceBtn').setAttribute('aria-expanded', String(open));
  }

  function addDevice(name, focus) {
    if (!Object.prototype.hasOwnProperty.call(DEVICE_NAMES, name)) return;
    if (devicesBox.querySelector('[data-device="' + name + '"]')) return;
    var card = $('tpl-' + name).content.firstElementChild.cloneNode(true);
    devicesBox.append(card);
    updateFormState();
    tickTimer();
    if (focus) {
      var first = card.querySelector('input, select');
      if (first) first.focus();
    }
  }

  function removeDevice(name) {
    var card = devicesBox.querySelector('[data-device="' + name + '"]');
    if (card) card.remove();
    if (name === 'bp' && draft) {
      draft.bp1SavedAt = null;
      draft.bp1Key = null;
      writeDraft(draft);
    }
    P.clearAlert(formAlert);
    updateFormState();
  }

  $('addDeviceBtn').addEventListener('click', function () {
    setMenu($('deviceMenu').hidden);
  });

  document.querySelectorAll('[data-device-option]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      addDevice(btn.getAttribute('data-device-option'), true);
      setMenu(false);
    });
  });

  devicesBox.addEventListener('click', function (e) {
    var remove = e.target.closest('[data-remove]');
    if (remove) { removeDevice(remove.getAttribute('data-remove')); return; }
    var save = e.target.closest('[data-save]');
    if (save) saveForNow(save.getAttribute('data-save'));
  });

  devicesBox.addEventListener('input', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-digits')) el.value = el.value.replace(/\D/g, '');
    else if (el.hasAttribute('data-decimal')) el.value = el.value.replace(/[^\d.,]/g, '');
  });

  devicesBox.addEventListener('change', function (e) {
    if (e.target.id === 'glucoseUnit') updateGlucoseHint();
  });

  function updateGlucoseHint() {
    var unit = $('glucoseUnit');
    var hint = $('glucoseHint');
    if (!unit || !hint) return;
    hint.textContent = unit.value === 'mmol/L'
      ? 'Most meters in Malaysia show mmol/L, for example 5.6.'
      : 'mg/dL is a whole number, for example 100.';
  }

  /* ---------- Note ---------- */
  function updateNoteUI() {
    var other = $('noteSelect').value === '__other';
    $('noteOtherField').hidden = !other;
    if (!other) $('noteOther').value = '';
  }

  $('noteSelect').addEventListener('change', function () {
    updateNoteUI();
    if (!$('noteOtherField').hidden) $('noteOther').focus();
  });

  /* ---------- Validation ---------- */
  function readInt(id, label, limits) {
    var input = $(id);
    var raw = input.value.trim();
    var n = Number(raw);
    if (!/^\d+$/.test(raw) || n < limits[0] || n > limits[1]) {
      P.setFieldError(input, label + ' must be a whole number from ' + limits[0] + ' to ' + limits[1] + '.');
      return null;
    }
    return n;
  }

  // prefix is "bp1" or "bp2". Reading 2 may be left completely empty.
  function readBp(prefix, label, required) {
    var ids = [prefix + 'Sys', prefix + 'Dia', prefix + 'Bpm'];
    var anyFilled = ids.some(function (id) { return $(id).value.trim() !== ''; });
    if (!anyFilled && !required) return { ok: true, value: null };

    var sys = readInt(ids[0], label + ' systolic', BP_LIMITS.systolic);
    var dia = readInt(ids[1], label + ' diastolic', BP_LIMITS.diastolic);
    var bpm = readInt(ids[2], label + ' BPM', BP_LIMITS.bpm);
    var ok = sys !== null && dia !== null && bpm !== null;
    if (ok && sys <= dia) {
      P.setFieldError($(ids[0]), 'Systolic must be higher than diastolic.');
      ok = false;
    }
    return { ok: ok, value: ok ? { systolic: sys, diastolic: dia, bpm: bpm } : null };
  }

  // Returns the data for one device card, or null when something is wrong (errors are shown on the fields).
  function validateDevice(name) {
    var card = devicesBox.querySelector('[data-device="' + name + '"]');
    if (!card) return {};
    P.clearFieldErrors(card);

    if (name === 'bp') {
      var r1 = readBp('bp1', 'Reading 1', true);
      var r2 = readBp('bp2', 'Reading 2', false);
      if (!r1.ok || !r2.ok) return null;
      return { bp1: r1.value, bp2: r2.value };
    }

    if (name === 'oximeter') {
      var spo2 = readInt('spo2', 'SpO₂', SPO2_LIMITS);
      var pulse = readInt('oxiBpm', 'Oximeter BPM', PULSE_LIMITS);
      if (spo2 === null || pulse === null) return null;
      return { oximeter: { spo2: spo2, bpm: pulse } };
    }

    var unit = $('glucoseUnit').value;
    var input = $('glucoseValue');
    var raw = input.value.trim().replace(',', '.');
    var n = Number(raw);
    var valid = unit === 'mmol/L'
      ? (/^\d{1,2}(\.\d)?$/.test(raw) && n >= 1 && n <= 40)
      : (/^\d{2,3}$/.test(raw) && n >= 20 && n <= 720);
    if (!valid) {
      P.setFieldError(input, unit === 'mmol/L'
        ? 'Glucose must be from 1.0 to 40.0 mmol/L, with one decimal at most.'
        : 'Glucose must be a whole number from 20 to 720 mg/dL.');
      return null;
    }
    return { glucose: { value: n, unit: unit } };
  }

  function focusFirstInvalid() {
    var bad = form.querySelector('[aria-invalid="true"]');
    if (bad) bad.focus();
  }

  /* ---------- Save for now (draft) ---------- */
  function collectValues() {
    var values = {};
    form.querySelectorAll('input[id], select[id]').forEach(function (el) { values[el.id] = el.value; });
    return values;
  }

  function restoreValues(values) {
    var targets = {};
    form.querySelectorAll('input[id], select[id]').forEach(function (el) { targets[el.id] = el; });
    Object.keys(values || {}).forEach(function (id) {
      var el = targets[id];
      if (!el) return;
      var value = String(values[id]);
      if (el.tagName === 'SELECT') {
        var exists = Array.prototype.some.call(el.options, function (o) { return o.value === value; });
        if (exists) el.value = value;
      } else {
        el.value = value;
      }
    });
  }

  function saveForNow(name) {
    P.clearAlert(formAlert);
    if (!validateDevice(name)) {
      focusFirstInvalid();
      P.showAlert(formAlert, 'warning', 'Please fix the highlighted fields before saving.');
      return;
    }

    var now = new Date().toISOString();
    var d = readDraft() || { v: 1, firstSavedAt: now, bp1SavedAt: null, bp1Key: null };
    d.devices = openDevices();
    d.values = collectValues();

    if (name === 'bp') {
      // The timer starts when Reading 1 is saved, and restarts only if Reading 1 changes.
      var key = [$('bp1Sys').value, $('bp1Dia').value, $('bp1Bpm').value].join('/');
      if (!d.bp1SavedAt || d.bp1Key !== key) { d.bp1SavedAt = now; d.bp1Key = key; }
    }

    if (!writeDraft(d)) {
      P.showAlert(formAlert, 'danger', 'This browser could not save the reading. You can still press Submit.', { title: 'Not saved' });
      return;
    }
    draft = d;
    P.showAlert(formAlert, 'success', DEVICE_NAMES[name] + ' is saved on this device. Press Submit when you are done.', { title: 'Saved for now', autoHide: true });
    tickTimer();
  }

  function resumeDraft() {
    if (!draft) return;
    devicesBox.replaceChildren();
    (draft.devices || []).forEach(function (name) { addDevice(name, false); });
    restoreValues(draft.values);
    updateNoteUI();
    updateGlucoseHint();
    banner.hidden = true;
    updateFormState();
    tickTimer();
  }

  $('draftContinue').addEventListener('click', resumeDraft);
  $('draftDiscard').addEventListener('click', function () {
    clearDraft();
    banner.hidden = true;
    updateFormState();
  });

  /* ---------- Countdown for blood pressure Reading 2 ---------- */
  function tickTimer() {
    var el = $('bpTimer');
    if (!el) return;

    if (!draft || !draft.bp1SavedAt) {
      el.className = 'timer';
      el.textContent = 'Fill in Reading 1 and press “Save for now” to start the 1-minute timer.';
      return;
    }

    var elapsed = Math.floor((Date.now() - new Date(draft.bp1SavedAt).getTime()) / 1000);
    if (elapsed < COUNTDOWN_SECONDS) {
      var left = COUNTDOWN_SECONDS - elapsed;
      el.className = 'timer';
      el.textContent = 'Wait ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' before Reading 2. You can still enter it or submit early.';
    } else if (elapsed <= LATE_SECONDS) {
      el.className = 'timer timer--ready';
      el.textContent = 'Reading 2 can be taken now. It is optional.';
    } else {
      el.className = 'timer';
      el.textContent = 'More than 2 minutes have passed since Reading 1. You can still enter Reading 2, or submit without it.';
    }
  }

  /* ---------- Submit ---------- */
  function clearForm(removeSavedDraft) {
    devicesBox.replaceChildren();
    $('noteSelect').value = '';
    updateNoteUI();
    P.clearFieldErrors(form);
    P.clearAlert(formAlert);
    if (removeSavedDraft) clearDraft();
    banner.hidden = true;
    updateFormState();
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    P.clearFieldErrors(form);
    P.clearAlert(formAlert);

    var names = openDevices();
    if (!names.length) {
      P.showAlert(formAlert, 'warning', 'Press “+ Add Reading” and add at least one device.');
      return;
    }

    var payload = { bp1: null, bp2: null, oximeter: null, glucose: null, note: null, measured_at: null };
    var ok = true;

    names.forEach(function (name) {
      var data = validateDevice(name);
      if (data) Object.assign(payload, data); else ok = false;
    });

    var choice = $('noteSelect').value;
    if (choice === '__other') {
      var typed = $('noteOther').value.trim();
      if (!typed) {
        P.setFieldError($('noteOther'), 'Type your note, or choose another option.');
        ok = false;
      } else {
        payload.note = typed.slice(0, 100);
      }
    } else if (choice) {
      payload.note = choice;
    }

    if (!ok) {
      focusFirstInvalid();
      P.showAlert(formAlert, 'warning', 'Please fix the highlighted fields.');
      return;
    }

    // Time the first reading was saved. The server only trusts it if it is recent.
    if (draft) payload.measured_at = draft.firstSavedAt;

    var btn = $('saveBtn');
    P.setBusy(btn, true, 'Submitting…');
    try {
      await P.api.addReading(payload);
      clearDraft();
      clearForm(false);
      P.showAlert(formAlert, 'success', 'Your reading has been saved to the database.', { title: 'Saved', autoHide: true });
      await loadReadings();
    } catch (err) {
      handleError(err, formAlert);
    }
    P.setBusy(btn, false);
  });

  $('clearBtn').addEventListener('click', function () { clearForm(true); });

  /* ---------- Display helpers ---------- */
  function whenParts(r) {
    var d = P.toDate(r.measured_at || r.created_at);
    return d ? { date: P.formatDate(d), time: P.formatTime(d) } : { date: '—', time: '—' };
  }

  function whenText(r) {
    var w = whenParts(r);
    return w.date + ', ' + w.time + (r.note ? ' · ' + r.note : '');
  }

  function bpText(sys, dia, bpm) {
    return sys == null ? '—' : sys + '/' + dia + ' · ' + bpm;
  }

  function glucoseText(r) {
    if (r.glucose_value == null) return '—';
    var v = r.glucose_unit === 'mmol/L' ? Number(r.glucose_value).toFixed(1) : String(Math.round(r.glucose_value));
    return v + ' ' + r.glucose_unit;
  }

  function findLatest(test) {
    for (var i = 0; i < readings.length; i++) {
      if (test(readings[i])) return readings[i];
    }
    return null;
  }

  /* ---------- Latest readings ---------- */
  function renderLatest() {
    var has = readings.length > 0;
    $('latestEmpty').hidden = has;
    $('latestWrap').hidden = !has;
    if (!has) {
      $('latestEmpty').textContent = loadFailed
        ? 'Readings could not be loaded.'
        : 'No readings yet. Press “+ Add Reading” to add your first one.';
      return;
    }

    var bp = findLatest(function (r) { return r.bp1_systolic != null; });
    $('latBp').textContent = bp ? bp.bp1_systolic + '/' + bp.bp1_diastolic : '—';
    $('latBpSub').textContent = bp ? 'Reading 1 · BPM ' + bp.bp1_bpm : '';
    var hasSecond = !!bp && bp.bp2_systolic != null;
    $('latBpSub2').hidden = !hasSecond;
    $('latBpSub2').textContent = hasSecond ? 'Reading 2 · ' + bp.bp2_systolic + '/' + bp.bp2_diastolic + ' · BPM ' + bp.bp2_bpm : '';
    $('latBpTime').textContent = bp ? whenText(bp) : 'No reading yet';

    var ox = findLatest(function (r) { return r.spo2 != null; });
    $('latSpo2').textContent = ox ? ox.spo2 : '—';
    $('latSpo2Sub').textContent = ox ? 'Oximeter BPM ' + ox.oximeter_bpm : '';
    $('latSpo2Time').textContent = ox ? whenText(ox) : 'No reading yet';

    var glu = findLatest(function (r) { return r.glucose_value != null; });
    $('latGlu').textContent = glu ? (glu.glucose_unit === 'mmol/L' ? Number(glu.glucose_value).toFixed(1) : String(Math.round(glu.glucose_value))) : '—';
    $('latGluUnit').textContent = glu ? glu.glucose_unit : '';
    $('latGluTime').textContent = glu ? whenText(glu) : 'No reading yet';
  }

  /* ---------- History (table and phone cards) ---------- */
  function cell(text, className) {
    var td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function buildRow(r, number) {
    var tr = document.createElement('tr');
    var w = whenParts(r);
    tr.append(
      cell(String(number), 'num'),
      cell(w.date),
      cell(w.time),
      cell(bpText(r.bp1_systolic, r.bp1_diastolic, r.bp1_bpm), 'num'),
      cell(bpText(r.bp2_systolic, r.bp2_diastolic, r.bp2_bpm), 'num'),
      cell(r.spo2 == null ? '—' : String(r.spo2), 'num'),
      cell(r.oximeter_bpm == null ? '—' : String(r.oximeter_bpm), 'num'),
      cell(glucoseText(r), 'num')
    );

    var noteTd = document.createElement('td');
    noteTd.className = 'note';
    if (r.note) {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = r.note;
      noteTd.append(tag);
    } else {
      noteTd.textContent = '—';
    }
    tr.append(noteTd);
    return tr;
  }

  function buildCard(r, number) {
    var article = document.createElement('article');
    article.className = 'entry-card';
    var w = whenParts(r);

    var head = document.createElement('div');
    head.className = 'entry-card__head';
    var when = document.createElement('strong');
    when.textContent = w.date + ' · ' + w.time;
    var no = document.createElement('span');
    no.textContent = '#' + number;
    head.append(when, no);

    var dl = document.createElement('dl');
    function add(label, value) {
      var wrap = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      dd.textContent = value;
      wrap.append(dt, dd);
      dl.append(wrap);
    }
    if (r.bp1_systolic != null) add('BP Reading 1', r.bp1_systolic + '/' + r.bp1_diastolic + ' mmHg · BPM ' + r.bp1_bpm);
    if (r.bp2_systolic != null) add('BP Reading 2', r.bp2_systolic + '/' + r.bp2_diastolic + ' mmHg · BPM ' + r.bp2_bpm);
    if (r.spo2 != null) add('Oximeter', 'SpO₂ ' + r.spo2 + '% · BPM ' + r.oximeter_bpm);
    if (r.glucose_value != null) add('Glucose', glucoseText(r));

    article.append(head, dl);
    if (r.note) {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = r.note;
      article.append(tag);
    }
    return article;
  }

  function renderHistory() {
    var body = $('readingsBody');
    var cards = $('historyCards');
    body.replaceChildren();
    cards.replaceChildren();

    var count = readings.length;
    $('historyCount').textContent = count ? '(' + count + (count === 1 ? ' entry)' : ' entries)') : '';
    $('historyEmpty').hidden = count > 0;
    $('tableWrap').hidden = count === 0;
    cards.hidden = count === 0;
    if (!count) {
      $('historyEmpty').textContent = loadFailed
        ? 'Readings could not be loaded.'
        : 'No readings yet. Add your first reading from the Dashboard.';
      return;
    }

    readings.forEach(function (r, i) {
      var number = count - i;
      body.append(buildRow(r, number));
      cards.append(buildCard(r, number));
    });
  }

  /* ---------- Loading / refreshing ---------- */
  function byNewest(a, b) {
    var da = P.toDate(a.measured_at || a.created_at);
    var db = P.toDate(b.measured_at || b.created_at);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (tb !== ta) return tb - ta;
    return (b.id || 0) - (a.id || 0);
  }

  async function loadReadings(manual) {
    if (loading) { reloadAgain = true; return; }
    loading = true;
    var buttons = document.querySelectorAll('.js-refresh');
    if (manual) buttons.forEach(function (btn) { P.setBusy(btn, true, 'Refreshing…'); });

    try {
      var res = await P.api.getReadings();
      readings = (res.readings || []).slice().sort(byNewest);
      loadFailed = false;
      P.clearAlert(alertBox);
      lastLoaded = Date.now();
      $('latUpdated').textContent = 'Updated ' + P.formatTime(new Date()) + '.';
    } catch (err) {
      readings = [];
      loadFailed = true;
      handleError(err);
    }

    renderLatest();
    renderHistory();
    if (manual) buttons.forEach(function (btn) { P.setBusy(btn, false); });
    loading = false;
    if (reloadAgain) { reloadAgain = false; loadReadings(); }
  }

  document.querySelectorAll('.js-refresh').forEach(function (btn) {
    btn.addEventListener('click', function () { loadReadings(true); });
  });

  // Keep the data fresh: when returning to the tab, and once a minute while the page is open.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastLoaded > 30000) loadReadings();
  });
  window.addEventListener('online', function () { loadReadings(); });
  setInterval(function () {
    if (document.visibilityState === 'visible') loadReadings();
  }, REFRESH_MS);

  /* ---------- Print / Export PDF ---------- */
  $('printBtn').addEventListener('click', function () {
    if (!readings.length) {
      P.showAlert(alertBox, 'info', 'There are no readings to print yet.');
      return;
    }
    var now = new Date();
    $('printDate').textContent = P.formatDate(now) + ', ' + P.formatTime(now);
    window.print();
  });

  /* ---------- Log out ---------- */
  $('logoutBtn').addEventListener('click', async function () {
    try { await P.api.logout(); } catch (err) { /* leave anyway */ }
    location.href = 'index.html';
  });

  /* ---------- Start ---------- */
  async function init() {
    try {
      me = await P.api.me();
    } catch (err) {
      if (err.status === 401) { location.replace('account.html'); return; }
      handleError(err);
      return;
    }
    if (me.role !== 'user') { location.replace('index.html'); return; }

    renderPatient();
    draft = readDraft();
    showDraftBanner();
    updateFormState();
    showView(location.hash.slice(1));
    setInterval(tickTimer, 1000);
    await loadReadings();
  }

  init();
})();
