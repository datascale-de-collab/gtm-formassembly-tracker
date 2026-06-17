/*!
 * Form Analytics Tracker (FormAssembly) - hosted runtime
 * Pairs with the "Form Analytics Tracker (FormAssembly)" GTM Custom Template.
 *
 * Reads window.faConfig (set by the template's sandboxed loader) and falls
 * back to the DEFAULTS below when loaded standalone (e.g. via a Custom HTML
 * tag). The same file serves both packaging options.
 *
 * Pushes the form lifecycle to window.dataLayer:
 *   view -> start -> step_N -> submit | error
 *
 * Transport is dataLayer.push only. The script makes no network calls itself.
 *
 * License: Apache-2.0
 */
(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];

  // ===================================================================
  // DEFAULTS  (override any key via window.faConfig BEFORE this loads)
  // ===================================================================
  var DEFAULTS = {
    // -- dataLayer schema --
    eventName:             'form_interaction',
    formInteractionType:   'lead_form',

    // -- timing --
    validationDelay:       600,    // ms after a submit click before reading errors
    viewportThreshold:     0.2,    // share of an inline form visible to count as "viewed"
    viewPollInterval:      300,    // ms between consent + visibility checks
    viewPollTimeout:       60000,  // give up waiting for the view gate after this

    // -- consent (OneTrust / OptanonConsent by default) --
    consentCookie:         'OptanonConsent',
    requiredConsentGroups: ['C0002'], // ALL listed groups must be granted (AND). [] = no gating.
    consentExemptActions:  [],        // actions that fire even without consent, e.g. ['submit']

    // -- audience --
    // Generic by default. Set audienceKey to a dataLayer property name to read
    // an audience from the page's dataLayer, or supply window.faConfig.audienceResolver
    // (function(dataLayer) -> string) for custom logic. Otherwise defaultAudience is used.
    defaultAudience:       'unknown',
    audienceKey:           '',

    // -- selectors --
    formSelectors: [
      'form[action*="formassembly"]',
      'form[action*="tfaforms"]',
      '.wForm form',
      'form[id^="tfa_"]'
    ],
    extraSelectors:  [],   // merged onto formSelectors
    submitSelector:  '[type="submit"], .wfPageSubmitButton, input[name="submit"], button[name="submit"]',
    nextSelector:    '.wfPageNextButton',
    prevSelector:    '.wfPagePrevButton',
    errorSelector:   '.errMsg, .wfErrorMessage, .error:not(:empty)',

    // -- misc --
    maxNameLength:   120,
    scanInterval:    250,
    scanMaxAttempts: 60,
    debugMode:       false
  };

  var CONFIG = {};
  (function mergeConfig() {
    var user = window.faConfig || {};
    for (var k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
        CONFIG[k] = Object.prototype.hasOwnProperty.call(user, k) ? user[k] : DEFAULTS[k];
      }
    }
  }());

  function log() {
    if (CONFIG.debugMode && window.console) {
      console.log.apply(console, ['[FA]'].concat([].slice.call(arguments)));
    }
  }

  // Optional page-context hook for custom audience logic.
  var audienceResolver = (window.faConfig && typeof window.faConfig.audienceResolver === 'function')
    ? window.faConfig.audienceResolver
    : null;

  // -- DOM helpers ----------------------------------------------------
  function matches(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
    return fn ? fn.call(el, selector) : false;
  }
  function closestMatch(el, selector, boundary) {
    while (el && el.nodeType === 1 && el !== boundary) {
      if (matches(el, selector)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function readCookie(name) {
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i].trim();
      if (c.indexOf(name + '=') === 0) return c.substring(name.length + 1);
    }
    return null;
  }

  // -- CONSENT --------------------------------------------------------
  // AND logic: every group in requiredConsentGroups must read ":1" in the
  // consent value. Empty list = gating disabled (always allowed).
  function analyticsAllowed() {
    var groups = CONFIG.requiredConsentGroups || [];
    if (groups.length === 0) return true;
    var raw = readCookie(CONFIG.consentCookie);
    if (!raw) return false;
    var val = decodeURIComponent(raw);
    for (var i = 0; i < groups.length; i++) {
      if (val.indexOf(groups[i] + ':1') === -1) return false;
    }
    return true;
  }

  // -- dedup ----------------------------------------------------------
  function isBound(el)   { return el.getAttribute('data-fa-bound') === '1'; }
  function markBound(el) { el.setAttribute('data-fa-bound', '1'); }

  // -- misc helpers ---------------------------------------------------
  function isInsideModal(form) {
    var node = form.parentElement;
    while (node && node !== document.body) {
      var cls  = ((node.className || '') + ' ' + (node.id || '')).toLowerCase();
      var role = (node.getAttribute('role') || '').toLowerCase();
      if (role === 'dialog')           return true;
      if (cls.indexOf('modal')   > -1) return true;
      if (cls.indexOf('popup')   > -1) return true;
      if (cls.indexOf('overlay') > -1) return true;
      if (cls.indexOf('drawer')  > -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isVisible(el) {
    if (!el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           parseFloat(style.opacity) > 0;
  }

  function cleanName(str) {
    str = (str || '').replace(/\s+/g, ' ').trim();
    if (str.length > CONFIG.maxNameLength) str = str.substring(0, CONFIG.maxNameLength).trim();
    return str;
  }

  function sanitizeToken(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function getFormName(form) {
    var modal = form.closest
      ? form.closest('[role="dialog"],.modal,.overlay,.popup,.drawer,[class*="modal"],[class*="popup"]')
      : null;
    if (modal) {
      var labelId = modal.getAttribute('aria-labelledby');
      if (labelId) {
        var lEl = document.getElementById(labelId);
        if (lEl && lEl.innerText && lEl.innerText.trim()) return cleanName(lEl.innerText);
      }
      var mt = modal.querySelector(
        '.modal-title,.dialog-title,[class*="modal-title"],[class*="dialog-title"],h1,h2,h3'
      );
      if (mt && mt.innerText && mt.innerText.trim()) return cleanName(mt.innerText);
    }
    var node = form.parentElement;
    while (node && node !== document.body) {
      var h = node.querySelector('h1,h2,h3');
      if (h && h.innerText && h.innerText.trim()) return cleanName(h.innerText);
      node = node.parentElement;
    }
    return cleanName((document.title || '').split('|')[0].split('-')[0]) || 'unknown_form';
  }

  // Generic audience resolution. No vendor- or site-specific logic baked in.
  //  1) window.faConfig.audienceResolver(dataLayer) -> string  (if provided)
  //  2) most recent dataLayer entry carrying CONFIG.audienceKey (if set)
  //  3) CONFIG.defaultAudience
  function getAudience() {
    if (audienceResolver) {
      try {
        var r = audienceResolver(window.dataLayer);
        if (r) return sanitizeToken(String(r));
      } catch (e) { log('audienceResolver error', e); }
    }
    if (CONFIG.audienceKey) {
      var dl = window.dataLayer;
      for (var i = dl.length - 1; i >= 0; i--) {
        var item = dl[i];
        if (item && item[CONFIG.audienceKey]) return sanitizeToken(String(item[CONFIG.audienceKey]));
      }
    }
    return CONFIG.defaultAudience;
  }

  // -- PUSH (consent centralised here) --------------------------------
  function push(action, formName, response, formTime, formId) {
    var exempt = CONFIG.consentExemptActions.indexOf(action) > -1;
    if (!exempt && !analyticsAllowed()) {
      log('suppressed (no consent):', action, formName);
      return;
    }
    var payload = {
      event:               CONFIG.eventName,
      formName:            formName,
      formId:              formId   !== undefined ? formId   : null,
      formAction:          action,
      formInteractionType: CONFIG.formInteractionType,
      formAudience:        getAudience(),
      formResponse:        response !== undefined ? response : null,
      formTime:            formTime !== undefined ? formTime : null
    };
    log(action, payload);
    window.dataLayer.push(payload);
  }

  // -- BIND FORM ------------------------------------------------------
  var instances = []; // { form, teardown }
  var formSeq   = 0;

  function bindForm(form) {
    var formName   = null;
    var formId     = form.id || ('form_' + (++formSeq));
    var startTime  = null;
    var submitTime = null;
    var step       = 1;
    var inModal    = isInsideModal(form);
    var viewFired  = false;
    var timers     = [];
    var io         = null;

    function getName() {
      return formName || (formName = getFormName(form));
    }

    // Elapsed SECONDS since form_start. Falls back to time since submit click
    // if start never fired (e.g. autofill without focusing a field).
    // GA4 custom metric: set unit to Seconds.
    function getElapsed() {
      if (startTime)  return Math.round((Date.now() - startTime)  / 1000);
      if (submitTime) return Math.round((Date.now() - submitTime) / 1000);
      return null;
    }

    function emit(action, response, formTime) {
      push(action, getName(), response, formTime, formId);
    }

    function teardown() {
      for (var i = 0; i < timers.length; i++) clearInterval(timers[i]);
      timers = [];
      if (io) { try { io.disconnect(); } catch (e) {} io = null; }
      form.removeEventListener('focusin', onFocusIn, true);
      form.removeEventListener('click', onClick, true);
      form.removeAttribute('data-fa-bound'); // allow rebind if the node is reused
    }

    // -- VIEW gate: poll BOTH visibility and consent every interval -----
    var formInView    = false;
    var viewPollCount = 0;
    var viewPollMax   = Math.ceil(CONFIG.viewPollTimeout / CONFIG.viewPollInterval);

    var viewPoller = setInterval(function () {
      if (!document.contains(form)) { teardown(); return; } // SPA self-heal
      if (++viewPollCount > viewPollMax) {
        clearInterval(viewPoller);
        log('view poll timed out', formId);
        return;
      }
      if (inModal && !formInView && isVisible(form)) {
        formInView = true;
        log('modal form visible', formId);
      }
      if (!formInView || !analyticsAllowed()) return;

      clearInterval(viewPoller);
      if (viewFired) return;
      viewFired = true;
      emit('view', null, null);
    }, CONFIG.viewPollInterval);
    timers.push(viewPoller);

    // Inline forms: IntersectionObserver sets the visibility flag.
    if (!inModal && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.unobserve(form);
          formInView = true;
          log('intersection observed', formId);
        });
      }, { threshold: CONFIG.viewportThreshold });
      io.observe(form);
    } else if (!inModal) {
      formInView = true;
    }

    // -- START ----------------------------------------------------------
    function onFocusIn(e) {
      var t = e.target.tagName;
      if (startTime) return;
      if (t !== 'INPUT' && t !== 'SELECT' && t !== 'TEXTAREA') return;
      startTime = Date.now();
      emit('start', null, 0); // suppressed by push() if consent is absent
    }
    form.addEventListener('focusin', onFocusIn, true);

    // -- STEP + SUBMIT (delegated; survives buttons added on later pages) -
    function onClick(e) {
      if (closestMatch(e.target, CONFIG.nextSelector, form)) {
        step++;
        emit('step_' + step, null, getElapsed());
        return;
      }
      if (closestMatch(e.target, CONFIG.prevSelector, form)) {
        step = Math.max(1, step - 1);
        return;
      }
      if (closestMatch(e.target, CONFIG.submitSelector, form)) {
        if (!submitTime) submitTime = Date.now();
        setTimeout(function () {
          if (!document.contains(form)) return;
          var errors = form.querySelectorAll(CONFIG.errorSelector);
          if (errors.length > 0) emit('error',  'validation_error', getElapsed());
          else                   emit('submit', 'success',          getElapsed());
        }, CONFIG.validationDelay);
      }
    }
    form.addEventListener('click', onClick, true);

    instances.push({ form: form, teardown: teardown });
  }

  // -- SCANNER --------------------------------------------------------
  var attempts = 0;
  var scanner  = null;

  function selectorList() {
    return (CONFIG.formSelectors || []).concat(CONFIG.extraSelectors || []);
  }

  function scan() {
    try {
      var sels = selectorList();
      for (var s = 0; s < sels.length; s++) {
        var forms = document.querySelectorAll(sels[s]);
        for (var f = 0; f < forms.length; f++) {
          if (!isBound(forms[f])) {
            markBound(forms[f]);
            try { bindForm(forms[f]); }
            catch (e) { log('bindForm error', e); }
          }
        }
      }
    } catch (e) {
      log('scan error', e);
    }
    if (++attempts > CONFIG.scanMaxAttempts) {
      clearInterval(scanner);
      log('scanner stopped');
    }
  }

  function startScanner() {
    attempts = 0;
    if (scanner) clearInterval(scanner);
    scanner = setInterval(scan, CONFIG.scanInterval);
    scan();
  }

  function cleanupDetached() {
    for (var i = instances.length - 1; i >= 0; i--) {
      if (!document.contains(instances[i].form)) {
        try { instances[i].teardown(); } catch (e) {}
        instances.splice(i, 1);
      }
    }
  }

  startScanner();

  // -- SPA ------------------------------------------------------------
  (function () {
    function onNav() {
      setTimeout(function () {
        cleanupDetached();
        startScanner();
        log('SPA navigation - rescanned');
      }, 500);
    }
    var _ps = history.pushState;
    var _rs = history.replaceState;
    history.pushState    = function () { var r = _ps.apply(history, arguments); onNav(); return r; };
    history.replaceState = function () { var r = _rs.apply(history, arguments); onNav(); return r; };
    window.addEventListener('popstate', onNav);
  }());

}());
