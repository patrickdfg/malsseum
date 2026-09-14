(function () {
  "use strict";

  var cfg = window.SAYEON_ANALYTICS_CONFIG || {};
  var ready = cfg.enabled === true && /^https:\/\//.test(cfg.supabaseUrl || "") && !!cfg.supabaseAnonKey;
  var lastView = "";
  var lastViewAt = 0;

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function storedId(store, key) {
    try {
      var value = store.getItem(key);
      if (!value) {
        value = randomId();
        store.setItem(key, value);
      }
      return value;
    } catch (e) {
      return randomId();
    }
  }

  var visitorId = storedId(localStorage, "sayeonAnalyticsVisitor");
  var sessionId = storedId(sessionStorage, "sayeonAnalyticsSession");

  function send(eventType, detail) {
    if (!ready) return Promise.resolve(false);
    detail = detail || {};
    return fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/record_analytics_event", {
      method: "POST",
      keepalive: true,
      headers: {
        "apikey": cfg.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_event_type: eventType,
        p_section: detail.section,
        p_visitor_id: visitorId,
        p_session_id: sessionId,
        p_item_no: detail.itemNo == null ? null : String(detail.itemNo),
        p_item_title: detail.itemTitle == null ? null : String(detail.itemTitle).slice(0, 300),
        p_content_year: detail.year == null ? null : String(detail.year),
        p_path: location.pathname
      })
    }).then(function (response) {
      return response.ok;
    }).catch(function () {
      return false;
    });
  }

  function trackSectionVisit(section) {
    var key = "sayeonAnalyticsVisited_" + section;
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch (e) {}
    send("section_visit", { section: section });
  }

  function trackPage(section, itemNo, itemTitle, year) {
    var key = [section, year || "", itemNo == null ? "" : itemNo].join(":");
    var now = Date.now();
    if (key === lastView && now - lastViewAt < 1500) return;
    lastView = key;
    lastViewAt = now;
    send("page_view", { section: section, itemNo: itemNo, itemTitle: itemTitle, year: year });
  }

  function trackRead(section, itemNo, itemTitle, year) {
    send("read_complete", { section: section, itemNo: itemNo, itemTitle: itemTitle, year: year });
  }

  window.SayeonAnalytics = Object.freeze({
    enabled: ready,
    trackSectionVisit: trackSectionVisit,
    trackPage: trackPage,
    trackRead: trackRead
  });
})();
