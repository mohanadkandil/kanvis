(() => {
  // ../../packages/core/src/editor-script.ts
  var STYLE_ID = "__kanvis_style__";
  var HOVER_OVERLAY_ID = "__kanvis_hover_overlay__";
  var SELECT_OVERLAY_ID = "__kanvis_select_overlay__";
  var HANDLE_CLASS = "__kanvis_handle__";
  var SPACING_SCALE = [0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
  var SPACING_TO_TW = {
    0: "0",
    1: "px",
    2: "0.5",
    4: "1",
    6: "1.5",
    8: "2",
    10: "2.5",
    12: "3",
    16: "4",
    20: "5",
    24: "6",
    32: "8",
    40: "10",
    48: "12",
    64: "16",
    80: "20",
    96: "24"
  };
  var hoverEl = null;
  var selectedEl = null;
  var selectedEls = [];
  var resizeObs = null;
  var MULTI_OVERLAY_PREFIX = "__kanvis_multi_overlay_";
  function sanitizeHtml(html) {
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<\/?script[^>]*>/gi, "").replace(/\son\w+\s*=\s*"[^"]*"/gi, "").replace(/\son\w+\s*=\s*'[^']*'/gi, "").replace(/\son\w+\s*=\s*[^\s>]+/gi, "").replace(/(\s(?:href|src|action|formaction)\s*=\s*["'])\s*javascript:/gi, "$1#blocked-").replace(/(\s(?:href|src)\s*=\s*["'])\s*data:text\/html/gi, "$1#blocked-");
  }
  function injectStyles() {
    if (document.getElementById(STYLE_ID))
      return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    #${HOVER_OVERLAY_ID}, #${SELECT_OVERLAY_ID} {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border-radius: 4px; box-sizing: border-box; display: none;
      transition: top 80ms ease-out, left 80ms ease-out, width 80ms ease-out, height 80ms ease-out;
    }
    #${HOVER_OVERLAY_ID} { border: 2px dashed rgba(59,130,246,0.55); }
    #${SELECT_OVERLAY_ID} { border: 2px solid rgb(59,130,246); box-shadow: 0 0 0 9999px rgba(0,0,0,0.04); }
    .${HANDLE_CLASS} {
      position: fixed; z-index: 2147483647; background: rgb(59,130,246);
      width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 2px white, 0 1px 3px rgba(0,0,0,0.25);
      pointer-events: auto;
    }
  `;
    document.documentElement.appendChild(style);
  }
  function ensureOverlay(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
    return el;
  }
  function positionOverlay(id, el) {
    const overlay = ensureOverlay(id);
    if (!el) {
      overlay.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      overlay.style.display = "none";
      return;
    }
    overlay.style.display = "block";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }
  function buildSelector(el) {
    if (el.id)
      return `#${CSS.escape(el.id)}`;
    const path = [];
    let node = el;
    while (node && node !== document.body && path.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length > 0) {
        part += "." + Array.from(node.classList).map((c) => CSS.escape(c)).join(".");
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node);
          part += `:nth-of-type(${idx + 1})`;
        }
      }
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(" > ");
  }
  function fingerprint(el) {
    const text = (el.textContent ?? "").trim().slice(0, 50);
    return `${el.tagName.toLowerCase()}|${text}`;
  }
  function captureSnapshot(el, maxChars = 16000) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(`#${HOVER_OVERLAY_ID}, #${SELECT_OVERLAY_ID}, .${HANDLE_CLASS}, [id^="${MULTI_OVERLAY_PREFIX}"], #${STYLE_ID}`).forEach((n) => n.remove());
    const html = clone.outerHTML ?? "";
    if (html.length <= maxChars)
      return html;
    return html.slice(0, maxChars) + " …[truncated]";
  }
  function rgbToHex(rgb) {
    if (/^#/.test(rgb))
      return rgb;
    const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m)
      return rgb;
    const r = parseInt(m[1] ?? "0", 10);
    const g = parseInt(m[2] ?? "0", 10);
    const b = parseInt(m[3] ?? "0", 10);
    const a = m[4] ? parseFloat(m[4]) : 1;
    if (a < 0.05)
      return "transparent";
    return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  function captureDesignTokens() {
    const body = getComputedStyle(document.body);
    const tokens = {
      body: {
        backgroundColor: rgbToHex(body.backgroundColor),
        color: rgbToHex(body.color),
        fontFamily: body.fontFamily,
        fontSize: body.fontSize,
        lineHeight: body.lineHeight
      },
      headings: {},
      link: null,
      button: null,
      topColors: [],
      topBackgrounds: [],
      radii: [],
      shadows: [],
      fontFamilies: []
    };
    for (const tag of ["h1", "h2", "h3"]) {
      const el = document.querySelector(tag);
      if (el) {
        const cs = getComputedStyle(el);
        tokens.headings[tag] = {
          color: rgbToHex(cs.color),
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight
        };
      }
    }
    const linkEl = document.querySelector("a[href]");
    if (linkEl) {
      const cs = getComputedStyle(linkEl);
      tokens.link = { color: rgbToHex(cs.color), textDecoration: cs.textDecoration.split(" ")[0] ?? "none" };
    }
    const btnEl = document.querySelector('button, .btn, [role="button"]');
    if (btnEl) {
      const cs = getComputedStyle(btnEl);
      tokens.button = {
        backgroundColor: rgbToHex(cs.backgroundColor),
        color: rgbToHex(cs.color),
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        fontFamily: cs.fontFamily
      };
    }
    const colorCounts = new Map;
    const bgCounts = new Map;
    const radiusCounts = new Map;
    const shadowSet = new Set;
    const fontSet = new Set;
    const targeted = Array.from(document.querySelectorAll('button, [role="button"], .btn, .button, ' + "h1, h2, h3, h4, " + '.card, [class*="card"], [class*="Card"], ' + '.badge, [class*="badge"], .tag, [class*="tag"], .pill, [class*="pill"], ' + '[class*="cta"], [class*="primary"], [class*="accent"], ' + "main > *, section > *, article > *, header > *")).slice(0, 200);
    const generic = Array.from(document.querySelectorAll("*")).slice(0, 800);
    const sampleEl = (el, weight) => {
      if (!el || isKanvisEl(el))
        return;
      const cs = getComputedStyle(el);
      const color = rgbToHex(cs.color);
      if (color !== "transparent")
        colorCounts.set(color, (colorCounts.get(color) ?? 0) + weight);
      const bg = rgbToHex(cs.backgroundColor);
      if (bg !== "transparent" && bg !== tokens.body.backgroundColor) {
        bgCounts.set(bg, (bgCounts.get(bg) ?? 0) + weight);
      }
      const r = cs.borderRadius;
      if (r && r !== "0px")
        radiusCounts.set(r, (radiusCounts.get(r) ?? 0) + weight);
      const sh = cs.boxShadow;
      if (sh && sh !== "none" && shadowSet.size < 4)
        shadowSet.add(sh);
      const ff = cs.fontFamily;
      if (ff && fontSet.size < 4)
        fontSet.add(ff);
    };
    for (const el of targeted)
      sampleEl(el, 3);
    for (const el of generic)
      sampleEl(el, 1);
    tokens.topColors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
    tokens.topBackgrounds = [...bgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
    tokens.radii = [...radiusCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r]) => r);
    tokens.shadows = [...shadowSet];
    tokens.fontFamilies = [...fontSet];
    return tokens;
  }
  function send(msg) {
    window.parent.postMessage(msg, "*");
  }
  function isKanvisEl(el) {
    if (!el)
      return true;
    return el.id === HOVER_OVERLAY_ID || el.id === SELECT_OVERLAY_ID || el.classList.contains(HANDLE_CLASS) || el.id === STYLE_ID;
  }
  function attachListeners() {
    document.addEventListener("mouseover", (e) => {
      const target = e.target;
      if (!target || isKanvisEl(target))
        return;
      hoverEl = target;
      positionOverlay(HOVER_OVERLAY_ID, target);
      send({ type: "kanvis:hover", selector: buildSelector(target) });
    }, true);
    document.addEventListener("mouseout", (e) => {
      const target = e.target;
      if (target === hoverEl) {
        hoverEl = null;
        positionOverlay(HOVER_OVERLAY_ID, null);
      }
    }, true);
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || isKanvisEl(target))
        return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleAdditionalSelection(target);
      } else {
        selectElement(target);
      }
    }, true);
    document.addEventListener("click", (e) => {
      const a = e.target?.closest("a");
      if (a) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
  function clearMultiOverlays() {
    document.querySelectorAll(`[id^="${MULTI_OVERLAY_PREFIX}"]`).forEach((n) => n.remove());
  }
  function renderMultiOverlays() {
    clearMultiOverlays();
    selectedEls.filter((el) => el !== selectedEl).forEach((el, i) => {
      const overlay = document.createElement("div");
      overlay.id = `${MULTI_OVERLAY_PREFIX}${i}`;
      Object.assign(overlay.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "2147483646",
        borderRadius: "4px",
        boxSizing: "border-box",
        border: "2px solid rgba(59,130,246,0.7)",
        boxShadow: "0 0 0 1px rgba(59,130,246,0.3)"
      });
      const rect = el.getBoundingClientRect();
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      document.body.appendChild(overlay);
    });
  }
  function emitSelectionState() {
    send({
      type: "kanvis:select",
      selector: selectedEl ? buildSelector(selectedEl) : "",
      tagName: selectedEl?.tagName ?? "",
      classes: selectedEl ? Array.from(selectedEl.classList) : [],
      text: selectedEl ? (selectedEl.textContent ?? "").trim().slice(0, 200) : "",
      inlineStyle: selectedEl ? selectedEl.style.cssText || "" : "",
      outerHtml: selectedEl ? captureSnapshot(selectedEl) : "",
      childCount: selectedEl ? selectedEl.children.length : 0,
      additional: selectedEls.filter((el) => el !== selectedEl).map((el) => ({
        selector: buildSelector(el),
        tagName: el.tagName,
        classes: Array.from(el.classList),
        text: (el.textContent ?? "").trim().slice(0, 200),
        inlineStyle: el.style.cssText || "",
        outerHtml: captureSnapshot(el),
        childCount: el.children.length
      }))
    });
  }
  function selectElement(el) {
    selectedEl = el;
    selectedEls = [el];
    positionOverlay(SELECT_OVERLAY_ID, el);
    positionOverlay(HOVER_OVERLAY_ID, null);
    clearMultiOverlays();
    emitSelectionState();
    showHandles(el);
    resizeObs?.disconnect();
    resizeObs = new ResizeObserver(() => {
      positionOverlay(SELECT_OVERLAY_ID, el);
      showHandles(el);
      renderMultiOverlays();
    });
    resizeObs.observe(el);
  }
  function toggleAdditionalSelection(el) {
    const idx = selectedEls.indexOf(el);
    if (idx >= 0) {
      selectedEls.splice(idx, 1);
      if (el === selectedEl) {
        selectedEl = selectedEls[0] ?? null;
      }
    } else {
      selectedEls.push(el);
    }
    if (selectedEl) {
      positionOverlay(SELECT_OVERLAY_ID, selectedEl);
      showHandles(selectedEl);
    } else {
      positionOverlay(SELECT_OVERLAY_ID, null);
      document.querySelectorAll(`.${HANDLE_CLASS}`).forEach((n) => n.remove());
    }
    renderMultiOverlays();
    emitSelectionState();
  }
  function showHandles(el) {
    document.querySelectorAll(`.${HANDLE_CLASS}`).forEach((n) => n.remove());
    const rect = el.getBoundingClientRect();
    const sides = [
      { side: "left", x: rect.left, y: rect.top + rect.height / 2 },
      { side: "right", x: rect.right, y: rect.top + rect.height / 2 },
      { side: "top", x: rect.left + rect.width / 2, y: rect.top },
      { side: "bottom", x: rect.left + rect.width / 2, y: rect.bottom }
    ];
    for (const { side, x, y } of sides) {
      const h = document.createElement("div");
      h.className = HANDLE_CLASS;
      h.style.left = `${x - 5}px`;
      h.style.top = `${y - 5}px`;
      h.style.cursor = side === "left" || side === "right" ? "ew-resize" : "ns-resize";
      h.addEventListener("mousedown", (e) => startDrag(e, el, side));
      document.body.appendChild(h);
    }
  }
  function startDrag(downEvent, el, side) {
    downEvent.preventDefault();
    downEvent.stopPropagation();
    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    const beforeClasses = Array.from(el.classList);
    const property = side === "left" ? "pl" : side === "right" ? "pr" : side === "top" ? "pt" : "pb";
    const currentClass = beforeClasses.find((c) => new RegExp(`^${property}-`).test(c));
    let currentValue = 16;
    if (currentClass) {
      const match = currentClass.match(/-(\d+)/);
      if (match && match[1])
        currentValue = parseInt(match[1], 10) * 4 || 16;
    }
    let raf = 0;
    function onMove(e) {
      if (raf)
        return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const delta = side === "left" ? -(e.clientX - startX) : side === "right" ? e.clientX - startX : side === "top" ? -(e.clientY - startY) : e.clientY - startY;
        const target = currentValue + delta;
        const snapped = SPACING_SCALE.reduce((p, c) => Math.abs(c - target) < Math.abs(p - target) ? c : p, SPACING_SCALE[0]);
        applyTailwindPadding(el, property, snapped);
      });
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const afterClasses = Array.from(el.classList);
      const beforeStr = beforeClasses.join(" ");
      const afterStr = afterClasses.join(" ");
      if (beforeStr !== afterStr) {
        const op = {
          kind: "dom",
          selector: buildSelector(el),
          fingerprint: fingerprint(el),
          property: "class",
          before: beforeStr,
          after: afterStr
        };
        send({ type: "kanvis:edit", op });
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  function applyTailwindPadding(el, property, valuePx) {
    const tw = SPACING_TO_TW[valuePx];
    if (!tw)
      return;
    const re = new RegExp(`^${property}-`);
    const filtered = Array.from(el.classList).filter((c) => !re.test(c));
    el.className = [...filtered, `${property}-${tw}`].join(" ");
  }
  function applyEditOp(op) {
    let el = document.querySelector(op.selector);
    if (!el) {
      el = Array.from(document.querySelectorAll(op.fingerprint.split("|")[0] ?? "*")).find((node) => fingerprint(node) === op.fingerprint) ?? null;
    }
    if (!el)
      return false;
    if (op.property === "class")
      el.className = op.after;
    return true;
  }
  function listenForParentMessages() {
    window.addEventListener("message", (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object" || !("type" in msg))
        return;
      if (msg.type === "kanvis:replay") {
        for (const op of msg.edits)
          applyEditOp(op);
      } else if (msg.type === "kanvis:reset") {
        window.location.reload();
      } else if (msg.type === "kanvis:apply-class") {
        let el = document.querySelector(msg.selector);
        if (!el && selectedEl) {
          const fp = fingerprint(selectedEl);
          el = Array.from(document.querySelectorAll(fp.split("|")[0] ?? "*")).find((node) => fingerprint(node) === fp) ?? null;
        }
        if (!el) {
          send({ type: "kanvis:apply-failed", selector: msg.selector, reason: "element_not_found" });
          return;
        }
        el.className = msg.after;
        if (selectedEl === el) {
          positionOverlay(SELECT_OVERLAY_ID, el);
          showHandles(el);
        }
        const op = {
          kind: "dom",
          selector: msg.selector,
          fingerprint: fingerprint(el),
          property: "class",
          before: msg.before,
          after: msg.after
        };
        send({ type: "kanvis:edit", op });
      } else if (msg.type === "kanvis:apply-styles") {
        let el = document.querySelector(msg.selector);
        if (!el && selectedEl) {
          const fp = fingerprint(selectedEl);
          el = Array.from(document.querySelectorAll(fp.split("|")[0] ?? "*")).find((node) => fingerprint(node) === fp) ?? null;
        }
        if (!el) {
          send({ type: "kanvis:apply-failed", selector: msg.selector, reason: "element_not_found" });
          return;
        }
        const beforeStyles = {};
        for (const prop of Object.keys(msg.styles)) {
          beforeStyles[prop] = el.style.getPropertyValue(prop);
        }
        for (const [prop, value] of Object.entries(msg.styles)) {
          el.style.setProperty(prop, value);
        }
        if (selectedEl === el) {
          positionOverlay(SELECT_OVERLAY_ID, el);
          showHandles(el);
        }
        send({
          type: "kanvis:edit",
          op: {
            kind: "style",
            selector: msg.selector,
            fingerprint: fingerprint(el),
            styles: msg.styles,
            beforeStyles,
            rationale: msg.rationale
          }
        });
      } else if (msg.type === "kanvis:apply-mutations") {
        const allSelectors = [msg.selector, ...msg.additionalSelectors ?? []];
        const targets = [];
        for (const sel of allSelectors) {
          let el = document.querySelector(sel);
          if (!el && selectedEl) {
            const fp = fingerprint(selectedEl);
            el = Array.from(document.querySelectorAll(fp.split("|")[0] ?? "*")).find((node) => fingerprint(node) === fp) ?? null;
          }
          if (el)
            targets.push(el);
        }
        if (targets.length === 0) {
          send({ type: "kanvis:apply-failed", selector: msg.selector, reason: "element_not_found" });
          return;
        }
        const styleMutations = msg.mutations.filter((m) => m.kind === "style");
        const textMutations = msg.mutations.filter((m) => m.kind === "text");
        const attrMutations = msg.mutations.filter((m) => m.kind === "attr");
        const htmlMutations = msg.mutations.filter((m) => m.kind === "html");
        for (let i = 0;i < targets.length; i++) {
          const el = targets[i];
          const elSelector = allSelectors[i] ?? msg.selector;
          if (styleMutations.length > 0) {
            const styles = {};
            const beforeStyles = {};
            for (const m of styleMutations) {
              beforeStyles[m.target] = el.style.getPropertyValue(m.target);
              styles[m.target] = m.value;
              el.style.setProperty(m.target, m.value);
            }
            send({
              type: "kanvis:edit",
              op: {
                kind: "style",
                selector: elSelector,
                fingerprint: fingerprint(el),
                styles,
                beforeStyles,
                rationale: msg.rationale
              }
            });
          }
          if (textMutations.length > 0) {
            const last = textMutations[textMutations.length - 1];
            if (last) {
              const before = el.textContent ?? "";
              el.textContent = last.value;
              send({
                type: "kanvis:edit",
                op: {
                  kind: "text",
                  selector: elSelector,
                  fingerprint: fingerprint(el),
                  before,
                  after: last.value,
                  rationale: msg.rationale
                }
              });
            }
          }
          if (attrMutations.length > 0) {
            const attributes = {};
            const beforeAttributes = {};
            for (const m of attrMutations) {
              beforeAttributes[m.target] = el.getAttribute(m.target) ?? "";
              attributes[m.target] = m.value;
              el.setAttribute(m.target, m.value);
            }
            send({
              type: "kanvis:edit",
              op: {
                kind: "attr",
                selector: elSelector,
                fingerprint: fingerprint(el),
                attributes,
                beforeAttributes,
                rationale: msg.rationale
              }
            });
          }
          if (htmlMutations.length > 0) {
            const last = htmlMutations[htmlMutations.length - 1];
            if (last) {
              const before = el.innerHTML;
              const safe = sanitizeHtml(last.value);
              el.innerHTML = safe;
              send({
                type: "kanvis:edit",
                op: {
                  kind: "html",
                  selector: elSelector,
                  fingerprint: fingerprint(el),
                  before,
                  after: safe,
                  rationale: msg.rationale
                }
              });
            }
          }
        }
        if (selectedEl) {
          positionOverlay(SELECT_OVERLAY_ID, selectedEl);
          showHandles(selectedEl);
        }
        renderMultiOverlays();
      }
    });
  }
  function start() {
    injectStyles();
    ensureOverlay(HOVER_OVERLAY_ID);
    ensureOverlay(SELECT_OVERLAY_ID);
    attachListeners();
    listenForParentMessages();
    const reposition = () => {
      if (hoverEl)
        positionOverlay(HOVER_OVERLAY_ID, hoverEl);
      if (selectedEl) {
        positionOverlay(SELECT_OVERLAY_ID, selectedEl);
        showHandles(selectedEl);
      }
      renderMultiOverlays();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    send({ type: "kanvis:ready" });
    const captureAndSend = (label) => {
      try {
        const tokens = captureDesignTokens();
        console.log(`[kanvis] design tokens captured (${label}):`, tokens);
        send({ type: "kanvis:design-tokens", tokens });
      } catch (e) {
        console.warn(`[kanvis] design token capture failed (${label}):`, e);
      }
    };
    setTimeout(() => captureAndSend("initial 800ms"), 800);
    setTimeout(() => captureAndSend("settled 2500ms"), 2500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
