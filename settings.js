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

  var DEF = { size: 16, lh: 1.95, pad: 18, font: 0,
              bg: '#1b2018', text: '#e9ece4', autoMode: 'prev', rate: 0.90 };
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
    '.sa-hex{font-size:15px;opacity:.7}';

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
  }

  global.SaSettings = {
    init: init, get: get, set: set, onChange: onChange,
    open: open, close: close, isOpen: isOpen,
    fonts: FONTS, themes: THEMES, mix: mix, isLight: isLight
  };
})(window);
