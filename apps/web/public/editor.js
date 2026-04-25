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
  var resizeObs = null;
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
      selectElement(target);
    }, true);
    document.addEventListener("click", (e) => {
      const a = e.target?.closest("a");
      if (a) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
  function selectElement(el) {
    selectedEl = el;
    positionOverlay(SELECT_OVERLAY_ID, el);
    positionOverlay(HOVER_OVERLAY_ID, null);
    send({
      type: "kanvis:select",
      selector: buildSelector(el),
      tagName: el.tagName,
      classes: Array.from(el.classList)
    });
    showHandles(el);
    resizeObs?.disconnect();
    resizeObs = new ResizeObserver(() => {
      positionOverlay(SELECT_OVERLAY_ID, el);
      showHandles(el);
    });
    resizeObs.observe(el);
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
        const el = document.querySelector(msg.selector);
        if (!el)
          return;
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
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    send({ type: "kanvis:ready" });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
