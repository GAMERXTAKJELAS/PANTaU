/* PANTaU — home page */
(function () {
  'use strict';

  var P = window.PANTaU;

  // Website online? If not, show the offline page.
  if (!navigator.onLine) {
    location.replace('offline.html?from=index.html');
    return;
  }

  // Already logged in? Go straight to the dashboard.
  P.api.me().then(function (me) {
    if (me && me.role === 'user') location.replace('dashboard.html');
  }).catch(function () { /* not logged in: stay on the home page */ });
})();
