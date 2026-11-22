/* PANTaU — patient dashboard */
(function () {
  'use strict';

  var P = window.PANTaU;
  var $ = function (id) { return document.getElementById(id); };

  var alertBox = $('alertArea');
  var formAlert = $('formAlert');
  var form = $('readingForm');
  var navButtons = document.querySelectorAll('[data-view]');
  var views = { dashboard: $('view-dashboard'), history: $('view-history') };
  var titles = {
    dashboard: ['Dashboard', 'Record a new reading and see your latest values.'],
    history: ['History', 'All readings recorded so far, newest first.']
  };

  // Wide limits that only catch typing mistakes. Not medical thresholds.
  var FIELDS = [
    { id: 'systolic', key: 'systolic', label: 'Systolic', min: 50, max: 300 },
    { id: 'diastolic', key: 'diastolic', label: 'Diastolic', min: 30, max: 200 },
    { id: 'bpBpm', key: 'bp_bpm', label: 'BPM (BP monitor)', min: 20, max: 250 },
    { id: 'spo2', key: 'spo2', label: 'SpO₂', min: 50, max: 100 },
    { id: 'oxiBpm', key: 'oximeter_bpm', label: 'Pulse (oximeter)', min: 20, max: 250 }
  ];

  var me = null;
  var readings = [];
  var loadFailed = false;

  /* ---------- Errors ---------- */
  function handleError(err, container) {
    if (err && err.status === 401) { location.replace('index.html'); return; }
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

  /* ---------- Render ---------- */
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

    $('pageSub').textContent = 'Hello, ' + me.name + '. ' + titles.dashboard[1];
    titles.dashboard[1] = $('pageSub').textContent;
  }

  function renderLatest() {
    var has = readings.length > 0;
    $('latestEmpty').hidden = has;
    $('latestWrap').hidden = !has;
    if (!has) {
      $('latestEmpty').textContent = loadFailed
        ? 'Readings could not be loaded.'
        : 'No readings yet. Add your first reading using the form.';
      return;
    }
    var r = readings[0];
    $('latBp').textContent = r.systolic + '/' + r.diastolic;
    $('latBpBpm').textContent = r.bp_bpm;
    $('latSpo2').textContent = r.spo2;
    $('latOxi').textContent = r.oximeter_bpm;
    var d = P.toDate(r.created_at);
    var when = d ? P.formatDate(d) + ', ' + P.formatTime(d) : '';
    $('latMeta').textContent = when + (r.note ? ' · ' + r.note : '');
  }

  function cell(text, className) {
    var td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function renderTable() {
    var body = $('readingsBody');
    body.replaceChildren();

    var count = readings.length;
    $('historyCount').textContent = count ? '(' + count + (count === 1 ? ' reading)' : ' readings)') : '';
    $('historyEmpty').hidden = count > 0;
    $('tableWrap').hidden = count === 0;
    if (!count) {
      $('historyEmpty').textContent = loadFailed
        ? 'Readings could not be loaded.'
        : 'No readings yet. Add your first reading from the Dashboard.';
      return;
    }

    readings.forEach(function (r, i) {
      var tr = document.createElement('tr');
      var d = P.toDate(r.created_at);

      tr.append(
        cell(String(count - i), 'num'),
        cell(d ? P.formatDate(d) : '—'),
        cell(d ? P.formatTime(d) : '—'),
        cell(String(r.systolic), 'num'),
        cell(String(r.diastolic), 'num'),
        cell(String(r.bp_bpm), 'num'),
        cell(String(r.spo2), 'num'),
        cell(String(r.oximeter_bpm), 'num')
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
      body.append(tr);
    });
  }

  function byNewest(a, b) {
    var da = P.toDate(a.created_at);
    var db = P.toDate(b.created_at);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (tb !== ta) return tb - ta;
    return (b.id || 0) - (a.id || 0);
  }

  async function loadReadings() {
    try {
      var res = await P.api.getReadings();
      readings = (res.readings || []).slice().sort(byNewest);
      loadFailed = false;
    } catch (err) {
      readings = [];
      loadFailed = true;
      handleError(err);
    }
    renderLatest();
    renderTable();
  }

  /* ---------- Note field ---------- */
  function updateNoteUI() {
    var other = $('noteSelect').value === '__other';
    $('noteOtherField').hidden = !other;
    if (!other) $('noteOther').value = '';
  }

  $('noteSelect').addEventListener('change', function () {
    updateNoteUI();
    if (!$('noteOtherField').hidden) $('noteOther').focus();
  });

  /* ---------- New reading ---------- */
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    P.clearFieldErrors(form);
    P.clearAlert(formAlert);

    var payload = {};
    var ok = true;

    FIELDS.forEach(function (f) {
      var input = $(f.id);
      var raw = input.value.trim();
      var n = Number(raw);
      if (!/^\d+$/.test(raw) || n < f.min || n > f.max) {
        P.setFieldError(input, f.label + ' must be a whole number from ' + f.min + ' to ' + f.max + '.');
        ok = false;
      } else {
        payload[f.key] = n;
      }
    });

    if (ok && payload.systolic <= payload.diastolic) {
      P.setFieldError($('systolic'), 'Systolic must be higher than diastolic.');
      ok = false;
    }

    var choice = $('noteSelect').value;
    var note = null;
    if (choice === '__other') {
      var typed = $('noteOther').value.trim();
      if (!typed) {
        P.setFieldError($('noteOther'), 'Type your note, or choose another option.');
        ok = false;
      } else {
        note = typed.slice(0, 100);
      }
    } else if (choice) {
      note = choice;
    }
    payload.note = note;

    if (!ok) {
      var firstBad = form.querySelector('[aria-invalid="true"]');
      if (firstBad) firstBad.focus();
      return;
    }

    var btn = $('saveBtn');
    P.setBusy(btn, true, 'Saving…');
    try {
      await P.api.addReading(payload);
      form.reset();
      updateNoteUI();
      P.showAlert(formAlert, 'success', 'Your reading has been saved.', { title: 'Saved', autoHide: true });
      await loadReadings();
    } catch (err) {
      handleError(err, formAlert);
    }
    P.setBusy(btn, false);
  });

  $('clearBtn').addEventListener('click', function () {
    form.reset();
    updateNoteUI();
    P.clearFieldErrors(form);
    P.clearAlert(formAlert);
  });

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
      if (err.status === 401) { location.replace('index.html'); return; }
      handleError(err);
      return;
    }
    if (me.role !== 'user') { location.replace('index.html'); return; }

    renderPatient();
    showView(location.hash.slice(1));
    await loadReadings();
  }

  init();
})();
