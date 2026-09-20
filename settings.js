/* 설정 — 세 페이지(성령사연·월명동·말씀)가 이 파일 하나를 같이 쓴다.
 *
 * 예전에는 페이지마다 설정 화면을 따로 두어서, 한 곳에 항목을 더하면
 * 나머지 두 곳에는 없는 일이 생겼다(반복듣기가 그랬다).
 * 이제 설정 화면도 저장도 여기 한 군데뿐이다.
 * 각 페이지는 바뀐 값을 받아 제 화면에 입히기만 한다.
 *
 * 쓰는 법:
 *   <script src="/sayeon/settings.js"></script>
 *   var cfg = null;
 *   SaSettings.onChange(function (c) { cfg = c; 내화면에입히기(c); });
 *   SaSettings.init({ unit: '편' });        // 월명동은 '항목'
 *   설정단추.onclick = SaSettings.open;
 *   암호를 풀고 들어간 뒤: SaSettings.askPush();   // 처음 한 번 '새 사연 알림' 묻기
 */
(function (global) {
  var KEY = 'siteSettings';

  var FONTS = [
    { k: '고딕', v: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif' },
    { k: '명조', v: '"Nanum Myeongjo", "Batang", "AppleMyungjo", serif' },
    { k: '돋움', v: '"Dotum", "Apple SD Gothic Neo", sans-serif' },
    { k: '굴림', v: '"Gulim", "Apple SD Gothic Neo", sans-serif' }
  ];
  var THEMES = [
    { k: '어두운 초록', bg: '#1b2018', text: '#e9ece4' },
    { k: '검정', bg: '#000000', text: '#e6e6e6' },
    { k: '남색', bg: '#0b1a3a', text: '#eaf1ff' },
    { k: '세피아', bg: '#f3e9d2', text: '#3a2f1b' },
    { k: '흰색', bg: '#ffffff', text: '#1a1a1a' }
  ];
  var MODES = ['prev', 'next', 'off', 'repeat'];

  // voice: 기기가 읽어 줄 때 쓸 목소리의 voiceURI. 빈 값이면 '기기가 고름'(구글 것 먼저).
  var DEF = { size: 16, lh: 1.95, pad: 18, font: 0,
              bg: '#1b2018', text: '#e9ece4', autoMode: 'prev', rate: 0.90, voice: '' };
  var RANGE = { size: [12, 30], lh: [1.2, 2.6], pad: [0, 60], rate: [0.5, 2.0] };
  var STEP = { size: 1, lh: 0.05, pad: 2, rate: 0.05 };

  var cfg = null, listeners = [], unit = '편', el = {};

  /* ===== 값 다루기 ===== */
  function clamp(name, v) {
    var r = RANGE[name];
    return Math.min(r[1], Math.max(r[0], v));
  }
  function raw() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function read() {
    var s = raw(), c = {}, k, i;
    for (k in DEF) { if (DEF.hasOwnProperty(k)) c[k] = DEF[k]; }
    if (typeof s.size === 'number') c.size = clamp('size', s.size);
    if (typeof s.lh === 'number') c.lh = clamp('lh', s.lh);
    if (typeof s.pad === 'number') c.pad = clamp('pad', s.pad);
    if (typeof s.font === 'number' && FONTS[s.font]) c.font = s.font;
    if (typeof s.bg === 'string') c.bg = s.bg;
    if (typeof s.text === 'string') c.text = s.text;
    if (typeof s.rate === 'number') c.rate = clamp('rate', s.rate);
    if (typeof s.voice === 'string') c.voice = s.voice;
    for (i = 0; i < MODES.length; i++) {
      if (s.autoMode === MODES[i]) c.autoMode = s.autoMode;
    }
    // 아주 예전 설정: 자동듣기를 꺼 두었던 것만 이어받는다
    if (s.autoMode === undefined && s.autoNext === false) c.autoMode = 'off';
    return c;
  }
  function store() {
    var s = raw(), k;
    for (k in cfg) { if (cfg.hasOwnProperty(k)) s[k] = cfg[k]; }
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  function get() {
    var c = {}, k;
    for (k in cfg) { if (cfg.hasOwnProperty(k)) c[k] = cfg[k]; }
    c.fontFamily = FONTS[cfg.font].v;
    return c;
  }
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](get()); } catch (e) {}
    }
  }
  function set(patch) {
    var k;
    for (k in patch) { if (patch.hasOwnProperty(k)) cfg[k] = patch[k]; }
    cfg.size = clamp('size', cfg.size);
    cfg.lh = clamp('lh', cfg.lh);
    cfg.pad = clamp('pad', cfg.pad);
    cfg.rate = clamp('rate', cfg.rate);
    store();
    paint();
    notify();
  }
  function bump(name, dir) {
    var v = cfg[name] + STEP[name] * dir, patch = {};
    patch[name] = (name === 'lh' || name === 'rate')
      ? Math.round(v * 100) / 100 : Math.round(v);
    set(patch);
  }

  /* ===== 읽어 주는 목소리 =====
   * 녹음이 없는 편(2025 성령사연, 월명동)은 기기가 그 자리에서 읽어 준다.
   * 기기에 깔린 한국어 목소리를 그대로 보여 주고, 고른 것을 세 페이지가 같이 쓴다.
   * 몇 개가 뜨는지는 기기마다 다르다 — 브라우저가 시스템 TTS 에서 받아 오는 것을
   * 그대로 내놓을 뿐이라, 우리가 늘릴 수 있는 것이 아니다.
   * 목록은 브라우저가 늦게 채우기도 하므로 voiceschanged 때 다시 그린다. */
  // 'kok'(코카니어) 처럼 ko 로 시작만 하는 다른 언어가 섞이지 않게 정확히 걸러낸다
  function isKoreanVoice(v) {
    if (!v || !v.lang) return false;
    var l = v.lang.toLowerCase().replace('_', '-');
    return l === 'ko' || l.indexOf('ko-') === 0;
  }
  function koVoices() {
    if (!global.speechSynthesis || !global.speechSynthesis.getVoices) return [];
    var vs;
    try { vs = global.speechSynthesis.getVoices() || []; } catch (e) { return []; }
    return vs.filter(isKoreanVoice);
  }
  function isGoogleVoice(v) {
    return /google|구글/i.test(v.name || '') || /^ko-kr-x-/i.test(v.voiceURI || '');
  }
  function voiceId(v) { return (v && (v.voiceURI || v.name)) || ''; }
  // 고른 것이 그 기기에 없으면(다른 폰에서 고른 값) 자동으로 되돌아간다
  function pickVoice() {
    var vs = koVoices(), i;
    if (!vs.length) return null;
    if (cfg && cfg.voice) {
      for (i = 0; i < vs.length; i++) { if (voiceId(vs[i]) === cfg.voice) return vs[i]; }
    }
    for (i = 0; i < vs.length; i++) { if (isGoogleVoice(vs[i])) return vs[i]; }
    return vs[0];
  }
  // 같은 이름이 두 번 나오는 기기가 많다. 구글 한국어 목소리가 기기 내장용과
  // 네트워크용으로 갈라져 있기 때문이다(문피아가 '(시스템)' 을 붙여 가른 것과 같다).
  // localService 로 먼저 가르고, 그래도 겹치면 뒤에 번호를 붙인다.
  function voiceLabels(vs) {
    var out = [], seen = {}, i, base;
    for (i = 0; i < vs.length; i++) {
      base = vs[i].name || vs[i].voiceURI || '이름 없는 목소리';
      if (vs[i].localService === false) base += ' (네트워크)';
      out.push(base);
    }
    for (i = 0; i < out.length; i++) { seen[out[i]] = (seen[out[i]] || 0) + 1; }
    var used = {};
    for (i = 0; i < out.length; i++) {
      if (seen[out[i]] > 1) {
        used[out[i]] = (used[out[i]] || 0) + 1;
        out[i] = out[i] + ' ' + used[out[i]];
      }
    }
    return out;
  }
  // 고르면 그 자리에서 한 마디 들려 준다. 이름만으로는 어느 목소리인지 모른다.
  function sampleVoice() {
    if (!global.speechSynthesis) return;
    try {
      global.speechSynthesis.cancel();
      var u = new global.SpeechSynthesisUtterance('이 목소리로 읽어 드립니다.');
      u.lang = 'ko-KR';
      var v = pickVoice();
      if (v) u.voice = v;
      u.rate = cfg.rate;
      global.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function stopSample() {
    try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (e) {}
  }
  function voiceListOpen(on) {
    if (!el.voice) return;
    el.voice.open = on;
    el.voice.list.className = on ? 'sa-list on' : 'sa-list';
    el.voice.bar.querySelector('.sa-bar-a').textContent = on ? '▲ 닫기' : '▼ 고르기';
    if (!on) stopSample();
  }
  function paintVoices() {
    if (!el.voice) return;
    var list = el.voice.list, vs = koVoices(), i;
    while (list.firstChild) { list.removeChild(list.firstChild); }
    if (!global.speechSynthesis) {
      el.voice.bar.style.display = 'none';
      el.voice.note.textContent = '이 브라우저는 기기 읽어주기를 못 합니다.';
      return;
    }
    if (!vs.length) {
      el.voice.bar.style.display = 'none';
      el.voice.note.textContent =
        '이 기기에서 한국어 목소리를 찾지 못했습니다. 폰 설정 → 음성 합성(TTS)에서 한국어를 받아 주세요.';
      return;
    }
    el.voice.bar.style.display = '';
    var labels = ['기기가 고름'], ids = [''], names = voiceLabels(vs);
    for (i = 0; i < vs.length; i++) { labels.push(names[i]); ids.push(voiceId(vs[i])); }
    var sel = 0;
    for (i = 1; i < ids.length; i++) { if (ids[i] === cfg.voice) sel = i; }
    if (cfg.voice && sel === 0) {
      // 다른 기기에서 고른 목소리가 여기엔 없다
      el.voice.note.textContent = '고른 목소리가 이 기기에 없어 기기가 고른 것으로 읽습니다. ' +
        '이 기기에는 한국어 목소리가 ' + vs.length + '개 있습니다.';
    } else {
      el.voice.note.textContent = '이 기기에 한국어 목소리 ' + vs.length + '개. ' +
        '고르면 그 목소리로 한 마디 들려 줍니다.';
    }
    el.voice.bar.querySelector('.sa-bar-v').textContent = labels[sel];
    for (i = 0; i < labels.length; i++) {
      (function (at) {
        var b = mk('button', at === sel ? 'sa-item sel' : 'sa-item');
        b.type = 'button';
        b.appendChild(mk('span', 'sa-item-t', labels[at]));
        b.appendChild(mk('span', 'sa-bar-a', at === sel ? '✓' : ''));
        b.onclick = function () {
          set({ voice: ids[at] });     // set 이 paintVoices 를 다시 부른다
          voiceListOpen(false);
          sampleVoice();
        };
        list.appendChild(b);
      })(i);
    }
    voiceListOpen(!!el.voice.open);
  }

  /* ===== 색 셈 ===== */
  function hex(c) {
    var s = String(c).replace('#', '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    return [parseInt(s.slice(0, 2), 16) || 0,
            parseInt(s.slice(2, 4), 16) || 0,
            parseInt(s.slice(4, 6), 16) || 0];
  }
  // 두 색 사이를 t 만큼 섞는다 (0 이면 a, 1 이면 b)
  function mix(a, b, t) {
    var x = hex(a), y = hex(b), out = '#', i, v;
    for (i = 0; i < 3; i++) {
      v = Math.round(x[i] + (y[i] - x[i]) * t);
      out += ('0' + Math.min(255, Math.max(0, v)).toString(16)).slice(-2);
    }
    return out;
  }
  // 배경이 밝은 색인지 (상태바 글자색 정할 때 쓴다)
  function isLight(c) {
    var v = hex(c);
    return (v[0] * 299 + v[1] * 587 + v[2] * 114) / 1000 > 140;
  }

  /* ===== 설정 화면 ===== */
  var CSS =
    '.sa-back{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.45);z-index:9998;display:none}' +
    '.sa-wrap{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9999;display:none;overflow:auto;' +
    '-webkit-overflow-scrolling:touch;background:var(--sa-bg);color:var(--sa-text);' +
    'font-family:var(--sa-font);line-height:1.6;' +
    'padding:calc(16px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom))}' +
    '.sa-wrap.on,.sa-back.on{display:block}' +
    '.sa-inner{max-width:780px;margin:0 auto}' +
    '.sa-top{display:flex;gap:8px;align-items:center;margin-bottom:18px}' +
    '.sa-top h2{font-size:20px;margin:0;flex:1;font-weight:700}' +
    '.sa-close{background:var(--sa-accent);color:var(--sa-on-accent);border:0;border-radius:8px;' +
    'padding:0 16px;font-size:16px;cursor:pointer;min-height:46px;font-family:inherit}' +
    '.sa-set{margin-bottom:22px}' +
    '.sa-name{font-size:15px;opacity:.7;margin-bottom:8px}' +
    '.sa-opts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    '.sa-opt{background:var(--sa-panel);color:var(--sa-text);border:0;border-radius:8px;' +
    'padding:10px 14px;font-size:15px;font-family:inherit;cursor:pointer;min-height:44px}' +
    '.sa-opt.sel{background:var(--sa-accent);color:var(--sa-on-accent);font-weight:700}' +
    '.sa-step{display:flex;align-items:center;gap:10px}' +
    '.sa-rnd{width:44px;height:44px;border-radius:50%;border:0;background:var(--sa-panel);' +
    'color:var(--sa-text);font-size:20px;cursor:pointer;font-family:inherit}' +
    '.sa-rnd[disabled]{opacity:.4}' +
    '.sa-val{font-weight:700;font-size:16px;min-width:62px;text-align:center}' +
    '.sa-color{display:flex;align-items:center;gap:12px}' +
    '.sa-color input{width:62px;height:44px;border:0;background:var(--sa-panel);' +
    'border-radius:8px;padding:4px;cursor:pointer}' +
    '.sa-hex{font-size:15px;opacity:.7}' +
    '.sa-note{font-size:14px;opacity:.75;margin-top:8px}' +
    /* 목소리는 수가 많아 낱개 단추로 늘어놓으면 화면을 다 먹는다.
       평소엔 고른 것만 막대로 보이고, 누르면 목록이 펼쳐진다. */
    '.sa-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
    'width:100%;background:var(--sa-panel);color:var(--sa-text);border:0;border-radius:10px;' +
    'padding:12px 14px;font-size:16px;font-family:inherit;cursor:pointer;min-height:48px;' +
    'text-align:left}' +
    '.sa-bar-v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sa-bar-a{flex:0 0 auto;opacity:.7;font-size:13px}' +
    '.sa-list{display:none;margin-top:8px;border-radius:10px;overflow:hidden;' +
    'border:1px solid var(--sa-panel);max-height:320px;overflow-y:auto}' +
    '.sa-list.on{display:block}' +
    '.sa-item{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
    'width:100%;background:transparent;color:var(--sa-text);border:0;' +
    'border-bottom:1px solid var(--sa-panel);padding:12px 14px;font-size:16px;' +
    'font-family:inherit;cursor:pointer;min-height:48px;text-align:left}' +
    '.sa-item:last-child{border-bottom:0}' +
    '.sa-item.sel{background:var(--sa-accent);color:var(--sa-on-accent);font-weight:700}' +
    '.sa-item-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sa-ask{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));' +
    'z-index:9997;max-width:520px;margin:0 auto;border-radius:14px;padding:16px;' +
    'background:var(--sa-bg);color:var(--sa-text);font-family:var(--sa-font);line-height:1.5;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid var(--sa-panel)}' +
    '.sa-ask-msg{font-size:16px;margin-bottom:12px;word-break:keep-all}' +
    '.sa-ask .sa-opts{justify-content:flex-end}';

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function section(name) {
    var s = mk('div', 'sa-set');
    s.appendChild(mk('div', 'sa-name', name));
    return s;
  }
  function optRow(labels, onPick) {
    var row = mk('div', 'sa-opts'), bs = [], i;
    for (i = 0; i < labels.length; i++) {
      (function (at) {
        var b = mk('button', 'sa-opt', labels[at]);
        b.type = 'button';
        b.onclick = function () { onPick(at); };
        row.appendChild(b);
        bs.push(b);
      })(i);
    }
    return { row: row, bs: bs };
  }
  function stepper(name, fmt) {
    var box = mk('div', 'sa-step');
    var minus = mk('button', 'sa-rnd', '−');
    var val = mk('span', 'sa-val');
    var plus = mk('button', 'sa-rnd', '+');
    minus.type = 'button';
    plus.type = 'button';
    minus.onclick = function () { bump(name, -1); };
    plus.onclick = function () { bump(name, 1); };
    box.appendChild(minus);
    box.appendChild(val);
    box.appendChild(plus);
    return { box: box, val: val, minus: minus, plus: plus, fmt: fmt };
  }
  function colorRow(key) {
    var row = mk('div', 'sa-color');
    var input = document.createElement('input');
    input.type = 'color';
    var hexLabel = mk('span', 'sa-hex');
    input.oninput = function () {
      var patch = {};
      patch[key] = input.value;
      set(patch);
    };
    row.appendChild(input);
    row.appendChild(hexLabel);
    return { row: row, input: input, hex: hexLabel };
  }

  /* ===== 새 사연 알림 (안드로이드) =====
   * '받기'를 누르면 이 기기를 알림 명단(Supabase)에 올린다.
   * 새 사연을 올리면 tools/send_push.py 가 명단에 있는 기기로 알림을 보내고,
   * 휴대폰에 온 알림은 /sayeon/sw.js 가 화면에 띄운다.
   * 아이폰은 홈 화면에 추가한 앱에서만 되고, 카카오톡 안 브라우저는 안 된다.
   * 아래 열쇠는 공개용이다(짝이 되는 비밀 열쇠는 깃허브 비밀값 VAPID_PRIVATE_KEY). */
  var VAPID_PUBLIC = 'BNFzT-GlQfl3u0rzlOVNKLJNmKGfVupMr1gg-9vO-6n9UDA-5q5R_cvf1XAKe0Aq2nRFPnXNPan8AqxzXl6Wp_s';
  var SW_URL = '/sayeon/sw.js', SW_SCOPE = '/sayeon/';

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function keyBytes(b64) {
    var s = (b64 + '==='.slice(0, (4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  // 방문 통계와 같은 Supabase 에, 명단에 올리고 내리는 공개 함수만 부른다
  function pushRpc(name, body) {
    var c = global.SAYEON_ANALYTICS_CONFIG || {};
    if (!c.supabaseUrl || !c.supabaseAnonKey) return Promise.reject(new Error('no config'));
    return fetch(c.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok) throw new Error('rpc ' + r.status); });
  }
  function pushSave(sub) {
    var j = sub.toJSON();
    return pushRpc('save_push_subscription',
      { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  }
  // 알림을 켠 적 없는 기기에는 서비스 워커를 등록하지 않는다
  function pushCurrent() {
    if (!pushSupported()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration(SW_SCOPE).then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).catch(function () { return null; });
  }
  function pushOn() {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('denied');
      return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        return sub || reg.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
      });
    }).then(pushSave);
  }
  function pushOff() {
    return pushCurrent().then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return pushRpc('remove_push_subscription', { p_endpoint: endpoint })
          .catch(function () {});   // 못 지워도 다음 발송 때 없는 기기로 걸러진다
      });
    });
  }
  // 서버를 거치지 않고 이 기기에서 바로 알림을 띄워 본다.
  // 이게 안 뜨면 폰의 알림 설정 문제, 이건 뜨는데 새 사연 알림만 안 오면 전달 문제다.
  function pushSelfTest() {
    return navigator.serviceWorker.getRegistration(SW_SCOPE).then(function (reg) {
      if (!reg) throw new Error('no sw');
      return reg.showNotification('알림 시험', {
        body: '이 기기에서 알림이 잘 뜹니다.',
        icon: '/sayeon/icons/icon-192.png?v=4',
        badge: '/sayeon/icons/icon-192.png?v=4',
        tag: 'sayeon-selftest',
        data: { url: '/sayeon/' }
      });
    });
  }
  function paintPush(msg) {
    if (!el.push) return;
    if (!pushSupported()) {
      el.push.row.style.display = 'none';
      el.pushNote.textContent = '이 브라우저에서는 알림을 받을 수 없습니다. 안드로이드 크롬에서 열어 주세요.';
      return;
    }
    pushCurrent().then(function (sub) {
      markSel(el.push, sub ? 0 : 1);
      el.pushTest.style.display = sub ? '' : 'none';
      if (msg) el.pushNote.textContent = msg;
      else if (Notification.permission === 'denied')
        el.pushNote.textContent = '알림이 막혀 있습니다. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.';
      else el.pushNote.textContent = sub ? '새 사연이 올라오면 알림이 옵니다.'
                                         : '새 사연이 올라오면 휴대폰으로 알려 드립니다.';
    });
  }
  /* 처음 들어온 기기에 한 번만 묻는다. 각 페이지가 암호를 풀고 들어간 뒤 부른다.
   * 알림이 안 되는 브라우저, 이미 허용했거나 막아 둔 기기, 전에 답한 기기에는 안 뜬다.
   * 답을 누르지 않고 지나가면 다음에 다시 묻는다. */
  var ASKED = 'sayeonPushAsked';
  function askPush() {
    if (!pushSupported() || Notification.permission !== 'default') return;
    try { if (localStorage.getItem(ASKED)) return; } catch (e) { return; }
    setTimeout(function () {
      if (document.querySelector('.sa-ask') || isOpen()) return;
      pushCurrent().then(function (sub) {
        if (sub) return;
        if (!cfg) cfg = read();
        var box = mk('div', 'sa-ask');
        var s = box.style;
        s.setProperty('--sa-bg', cfg.bg);
        s.setProperty('--sa-text', cfg.text);
        s.setProperty('--sa-font', FONTS[cfg.font].v);
        s.setProperty('--sa-panel', mix(cfg.bg, cfg.text, 0.14));
        s.setProperty('--sa-accent', mix(cfg.bg, cfg.text, 0.72));
        s.setProperty('--sa-on-accent', cfg.bg);
        var msg = mk('div', 'sa-ask-msg', '🔔 새 사연이 올라오면 알림을 받으시겠어요?');
        var btns = optRow(['나중에', '받기'], function (at) {
          try { localStorage.setItem(ASKED, at === 1 ? 'yes' : 'later'); } catch (e) {}
          if (at === 0) { box.parentNode.removeChild(box); return; }
          btns.row.style.display = 'none';
          msg.textContent = '잠시만요…';
          pushOn().then(function () {
            msg.textContent = '알림을 받습니다. 설정에서 언제든 끌 수 있습니다.';
          }).catch(function (e) {
            msg.textContent = e && e.message === 'denied'
              ? '알림을 허용하지 않았습니다. 나중에 설정에서 켤 수 있습니다.'
              : '알림 설정에 실패했습니다. 설정 → 새 사연 알림에서 다시 눌러 주세요.';
          }).then(function () {
            setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3000);
          });
        });
        btns.bs[1].className = 'sa-opt sel';
        box.appendChild(msg);
        box.appendChild(btns.row);
        document.body.appendChild(box);
      });
    }, 2500);   // 들어오자마자 가리지 않도록 조금 뒤에
  }

  // 알림을 켜 둔 기기는 들어올 때마다 명단을 새로 고친다(주소가 바뀌는 일이 있다)
  function pushRefresh() {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    pushCurrent().then(function (sub) { if (sub) pushSave(sub).catch(function () {}); });
  }

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    el.back = mk('div', 'sa-back');
    el.back.onclick = close;
    el.wrap = mk('div', 'sa-wrap');
    var inner = mk('div', 'sa-inner');

    var top = mk('div', 'sa-top');
    top.appendChild(mk('h2', null, '설정'));
    var x = mk('button', 'sa-close', '닫기');
    x.type = 'button';
    x.onclick = close;
    top.appendChild(x);
    inner.appendChild(top);

    var s, names = [], i;

    s = section('새 사연 알림');
    el.push = optRow(['받기', '안 받기'], function (at) {
      el.pushNote.textContent = '잠시만요…';
      (at === 0 ? pushOn() : pushOff()).then(function () {
        paintPush();
      }).catch(function (e) {
        paintPush(e && e.message === 'denied'
          ? '알림을 허용해야 받을 수 있습니다.'
          : '알림 설정에 실패했습니다. 잠시 뒤 다시 눌러 주세요.');
      });
    });
    el.pushTest = mk('button', 'sa-opt', '이 기기에서 시험');
    el.pushTest.type = 'button';
    el.pushTest.style.display = 'none';
    el.pushTest.onclick = function () {
      pushSelfTest().then(function () {
        el.pushNote.textContent = '시험 알림을 띄웠습니다. 알림창을 내려 확인해 보세요. ' +
          '안 보이면 폰 설정 → 앱 → 성령사연(또는 크롬) → 알림을 켜 주세요.';
      }).catch(function () {
        el.pushNote.textContent = '알림을 띄우지 못했습니다. 안 받기 → 받기를 다시 눌러 주세요.';
      });
    };
    el.push.row.appendChild(el.pushTest);
    s.appendChild(el.push.row);
    el.pushNote = mk('div', 'sa-note');
    s.appendChild(el.pushNote);
    inner.appendChild(s);

    s = section('읽기');
    el.mode = optRow(['이전 ' + unit + ' 이어 듣기', '다음 ' + unit + ' 이어 듣기',
                      '현재 ' + unit + '만 듣기', '현재 ' + unit + ' 반복 듣기'],
                     function (at) { set({ autoMode: MODES[at] }); });
    s.appendChild(el.mode.row);
    inner.appendChild(s);

    s = section('글자 크기');
    el.size = stepper('size', function (v) { return v + 'px'; });
    s.appendChild(el.size.box);
    inner.appendChild(s);

    for (i = 0; i < FONTS.length; i++) { names.push(FONTS[i].k); }
    s = section('글자체');
    el.font = optRow(names, function (at) { set({ font: at }); });
    s.appendChild(el.font.row);
    inner.appendChild(s);

    s = section('줄 간격');
    el.lh = stepper('lh', function (v) { return v.toFixed(2); });
    s.appendChild(el.lh.box);
    inner.appendChild(s);

    s = section('읽기 속도');
    el.rate = stepper('rate', function (v) { return Math.round(v * 100) + '%'; });
    s.appendChild(el.rate.box);
    inner.appendChild(s);

    // 기기가 읽어 주는 편에만 쓰인다 (녹음이 있는 편은 그 파일을 튼다)
    s = section('읽어 주는 목소리');
    var vbar = mk('button', 'sa-bar');
    vbar.type = 'button';
    vbar.appendChild(mk('span', 'sa-bar-v', '기기가 고름'));
    vbar.appendChild(mk('span', 'sa-bar-a', '▼ 고르기'));
    el.voice = { bar: vbar, list: mk('div', 'sa-list'), note: mk('div', 'sa-note'), open: false };
    vbar.onclick = function () { voiceListOpen(!el.voice.open); };
    s.appendChild(vbar);
    s.appendChild(el.voice.list);
    s.appendChild(el.voice.note);
    inner.appendChild(s);
    if (global.speechSynthesis && 'onvoiceschanged' in global.speechSynthesis) {
      global.speechSynthesis.onvoiceschanged = function () { paintVoices(); };
    }

    s = section('좌우 여백');
    el.pad = stepper('pad', function (v) { return v + 'px'; });
    s.appendChild(el.pad.box);
    inner.appendChild(s);

    names = [];
    for (i = 0; i < THEMES.length; i++) { names.push(THEMES[i].k); }
    s = section('테마');
    el.theme = optRow(names, function (at) {
      set({ bg: THEMES[at].bg, text: THEMES[at].text });
    });
    s.appendChild(el.theme.row);
    inner.appendChild(s);

    s = section('글자색');
    el.textColor = colorRow('text');
    s.appendChild(el.textColor.row);
    inner.appendChild(s);

    s = section('배경색');
    el.bgColor = colorRow('bg');
    s.appendChild(el.bgColor.row);
    inner.appendChild(s);

    var resetRow = mk('div', 'sa-opts');
    var rb = mk('button', 'sa-opt', '기본값으로');
    rb.type = 'button';
    rb.onclick = function () { set(DEF); };
    resetRow.appendChild(rb);
    inner.appendChild(resetRow);

    el.wrap.appendChild(inner);
    document.body.appendChild(el.back);
    document.body.appendChild(el.wrap);
  }

  function markSel(group, sel) {
    for (var i = 0; i < group.bs.length; i++) {
      group.bs[i].className = (i === sel) ? 'sa-opt sel' : 'sa-opt';
    }
  }
  function paintStep(st, name) {
    st.val.textContent = st.fmt(cfg[name]);
    st.minus.disabled = cfg[name] <= RANGE[name][0];
    st.plus.disabled = cfg[name] >= RANGE[name][1];
  }
  function themeIndex() {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].bg === cfg.bg && THEMES[i].text === cfg.text) return i;
    }
    return -1;
  }
  function modeIndex() {
    for (var i = 0; i < MODES.length; i++) {
      if (MODES[i] === cfg.autoMode) return i;
    }
    return -1;
  }
  // 설정 화면도 고른 색과 글자체를 그대로 입는다
  function paintSkin() {
    var s = el.wrap.style;
    s.setProperty('--sa-bg', cfg.bg);
    s.setProperty('--sa-text', cfg.text);
    s.setProperty('--sa-font', FONTS[cfg.font].v);
    s.setProperty('--sa-panel', mix(cfg.bg, cfg.text, 0.14));
    s.setProperty('--sa-accent', mix(cfg.bg, cfg.text, 0.72));
    s.setProperty('--sa-on-accent', cfg.bg);
  }
  function paint() {
    if (!el.wrap) return;
    markSel(el.mode, modeIndex());
    markSel(el.font, cfg.font);
    markSel(el.theme, themeIndex());
    paintStep(el.size, 'size');
    paintStep(el.lh, 'lh');
    paintStep(el.rate, 'rate');
    paintStep(el.pad, 'pad');
    el.textColor.input.value = cfg.text;
    el.textColor.hex.textContent = cfg.text;
    el.bgColor.input.value = cfg.bg;
    el.bgColor.hex.textContent = cfg.bg;
    paintSkin();
    paintPush();
    paintVoices();
  }

  function open() {
    if (!el.wrap) return;
    paint();
    el.back.className = 'sa-back on';
    el.wrap.className = 'sa-wrap on';
    el.wrap.scrollTop = 0;
  }
  function close() {
    if (!el.wrap) return;
    stopSample();      // 미리 듣던 한 마디가 설정을 닫은 뒤에도 이어지지 않게
    if (el.voice) el.voice.open = false;   // 다음에 열 때는 막대만 보이게
    el.back.className = 'sa-back';
    el.wrap.className = 'sa-wrap';
  }
  function isOpen() {
    return !!el.wrap && el.wrap.className.indexOf('on') >= 0;
  }
  function onChange(fn) { listeners.push(fn); }

  function init(opts) {
    if (opts && opts.unit) unit = opts.unit;
    cfg = read();
    build();
    paint();
    notify();
    pushRefresh();
  }

  global.SaSettings = {
    init: init, get: get, set: set, onChange: onChange,
    open: open, close: close, isOpen: isOpen, askPush: askPush,
    // 세 페이지가 같은 목소리를 쓰도록 고르는 일은 여기 한 곳에서만 한다
    voices: koVoices, pickVoice: pickVoice,
    fonts: FONTS, themes: THEMES, mix: mix, isLight: isLight
  };
})(window);
