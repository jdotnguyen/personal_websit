(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Small bits ---------------- */

  function setCopyrightYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = String(new Date().getFullYear());
  }

  function initClock() {
    var el = document.getElementById("ottawa-time");
    if (!el) return;
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) {
      return;
    }
    function tick() {
      el.textContent = fmt.format(new Date());
    }
    tick();
    setInterval(tick, 15000);
  }

  function initHeader() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    function update() {
      header.classList.toggle("is-scrolled", window.scrollY > 24);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  /* Ambient light: the left-edge strip takes the colour of the section in the middle of the screen. */
  function initAmbient() {
    var zones = document.querySelectorAll("[data-ambient-zone]");
    if (!zones.length || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            document.body.setAttribute("data-ambient", entry.target.getAttribute("data-ambient-zone"));
          }
        });
      },
      { rootMargin: "-50% 0px -50% 0px" }
    );
    zones.forEach(function (z) { io.observe(z); });
  }

  /* ---------------- Hero: long-exposure light trails ---------------- */

  function initTrails() {
    var canvas = document.getElementById("trails");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var hero = canvas.parentElement;
    var w = 0, h = 0, dpr = 1;
    var vp = { x: 0, y: 0 };
    var steer = { x: 0, y: 0, tx: 0, ty: 0 };
    var running = false;
    var visible = true;
    var lights = [];
    var time = 0;

    // Lanes: offset of the lane at the bottom of the screen, as a fraction of width from the vanishing point.
    // dir 1 = oncoming headlights (towards you), dir -1 = taillights (away from you).
    var LANES = [
      { off: -1.35, dir: 1, color: [255, 240, 215] },
      { off: -0.85, dir: 1, color: [214, 232, 255] },
      { off: -0.4, dir: 1, color: [235, 242, 255] },
      { off: 0.3, dir: -1, color: [255, 40, 64] },
      { off: 0.72, dir: -1, color: [255, 64, 52] },
      { off: 1.15, dir: -1, color: [255, 30, 80] }
    ];
    var POLES = [-2.1, 1.7]; // street-light rows on both shoulders

    function resize() {
      var rect = hero.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(kind, laneIdx, t) {
      var lane = kind === "pole" ? null : LANES[laneIdx];
      return {
        kind: kind,
        lane: laneIdx,
        t: t,
        speed: kind === "pole" ? 0.0042 : (0.0032 + Math.random() * 0.0034) * (lane.dir === 1 ? 1.25 : 0.85),
        side: kind === "pole" ? POLES[laneIdx] : 0,
        jitter: Math.random() * 0.06 - 0.03,
        prev: null
      };
    }

    function seed() {
      lights = [];
      LANES.forEach(function (_, i) {
        for (var n = 0; n < 6; n++) lights.push(spawn("car", i, Math.random()));
      });
      POLES.forEach(function (_, i) {
        for (var n = 0; n < 7; n++) lights.push(spawn("pole", i, n / 7));
      });
    }

    // Point on the road. t: 0 at the horizon, 1 at the bottom edge.
    function roadPoint(offset, t) {
      var bend = Math.sin(time * 0.00025) * 0.18 + steer.x * 0.25; // gentle curve
      var depth = t * t; // perspective
      var bx = vp.x + offset * w * 0.75;
      var by = h * 1.08;
      // quadratic curve: control point pushed sideways by the bend
      var cx = vp.x + (bx - vp.x) * 0.35 + bend * w * 0.35;
      var cy = vp.y + (by - vp.y) * 0.25;
      var u = depth;
      var x = (1 - u) * (1 - u) * vp.x + 2 * (1 - u) * u * cx + u * u * bx;
      var y = (1 - u) * (1 - u) * vp.y + 2 * (1 - u) * u * cy + u * u * by;
      return { x: x, y: y, scale: 0.2 + depth * 2.4 };
    }

    function step(fade) {
      time += 16;
      steer.x += (steer.tx - steer.x) * 0.04;
      steer.y += (steer.ty - steer.y) * 0.04;
      vp.x = w * (0.72 + steer.x * 0.1);
      vp.y = h * (0.46 + steer.y * 0.06);

      if (fade) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,0.055)";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      for (var i = 0; i < lights.length; i++) {
        var L = lights[i];
        var lane = L.kind === "car" ? LANES[L.lane] : null;
        var dir = lane ? lane.dir : 1;
        var accel = 0.25 + L.t * 1.6;
        L.t += L.speed * accel * dir;

        if (L.t > 1.05 || L.t < 0) {
          var fresh = spawn(L.kind, L.lane, dir === 1 ? 0 : 1.04);
          lights[i] = fresh;
          continue;
        }

        var off = lane ? lane.off + L.jitter : L.side;
        var p = roadPoint(off, Math.max(0, L.t));

        if (L.prev) {
          var alpha, color, width;
          if (L.kind === "pole") {
            color = [255, 170, 80];
            alpha = 0.3 + L.t * 0.4;
            width = 0.6 + p.scale * 1.4;
          } else {
            color = lane.color;
            alpha = Math.min(1, 0.4 + L.t * 0.9);
            width = 0.8 + p.scale * 2.2;
          }
          var rgba = "rgba(" + color[0] + "," + color[1] + "," + color[2] + ",";
          if (L.kind === "car") {
            // a car is a pair of lights
            var spread = p.scale * 7;
            for (var k = -1; k <= 1; k += 2) {
              ctx.strokeStyle = rgba + alpha * 0.18 + ")";
              ctx.lineWidth = width * 5;
              ctx.beginPath();
              ctx.moveTo(L.prev.x + k * L.prev.s, L.prev.y);
              ctx.lineTo(p.x + k * spread, p.y);
              ctx.stroke();
              ctx.strokeStyle = rgba + alpha + ")";
              ctx.lineWidth = width;
              ctx.beginPath();
              ctx.moveTo(L.prev.x + k * L.prev.s, L.prev.y);
              ctx.lineTo(p.x + k * spread, p.y);
              ctx.stroke();
            }
            L.prev = { x: p.x, y: p.y, s: spread };
            continue;
          }
          ctx.strokeStyle = rgba + alpha + ")";
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(L.prev.x, L.prev.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        L.prev = { x: p.x, y: p.y, s: p.scale * 7 };
      }
    }

    function frame() {
      if (!running) return;
      step(true);
      requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduceMotion || !visible || document.hidden) return;
      running = true;
      requestAnimationFrame(frame);
    }
    function stop() { running = false; }

    function drawStill() {
      // Reduced motion: one frozen long exposure.
      ctx.clearRect(0, 0, w, h);
      seed();
      for (var n = 0; n < 260; n++) step(false);
    }

    resize();
    seed();

    if (reduceMotion) {
      drawStill();
      window.addEventListener("resize", function () { resize(); drawStill(); });
      return;
    }

    window.addEventListener("resize", function () {
      resize();
      lights.forEach(function (L) { L.prev = null; });
    });

    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      steer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      steer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });
    hero.addEventListener("pointerleave", function () { steer.tx = 0; steer.ty = 0; });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start(); else stop();
      }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });

    // Warm up so the first frame already has streaks.
    for (var n = 0; n < 160; n++) step(true);
    start();
  }

  /* ---------------- Infotainment screen switcher ---------------- */

  function initDash() {
    var keys = Array.prototype.slice.call(document.querySelectorAll(".dash__key"));
    var screen = document.getElementById("dash-screen");
    var img = document.getElementById("dash-img");
    var caption = document.getElementById("dash-caption");
    if (!keys.length || !img) return;

    // Preload the other screens so switching is instant.
    keys.forEach(function (k) { var i = new Image(); i.src = k.getAttribute("data-src"); });

    function select(key, focus) {
      keys.forEach(function (k) {
        var on = k === key;
        k.setAttribute("aria-selected", on ? "true" : "false");
        k.tabIndex = on ? 0 : -1;
      });
      if (focus) key.focus();
      var src = key.getAttribute("data-src");
      if (img.getAttribute("src") === src) return;
      var swap = function () {
        img.src = src;
        img.alt = key.getAttribute("data-alt");
        caption.textContent = key.getAttribute("data-caption");
        screen.classList.remove("is-switching");
      };
      if (reduceMotion) { swap(); return; }
      screen.classList.add("is-switching");
      setTimeout(swap, 200);
    }

    keys.forEach(function (key, i) {
      key.addEventListener("click", function () { select(key, false); });
      key.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = keys[(i + 1) % keys.length];
        if (e.key === "ArrowLeft") next = keys[(i - 1 + keys.length) % keys.length];
        if (e.key === "Home") next = keys[0];
        if (e.key === "End") next = keys[keys.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  }

  /* ---------------- Pokédex preview ---------------- */

  var TYPE_COLORS = {
    normal: "#A4ACAF", fire: "#FB6C6C", water: "#77BDFE", electric: "#FFCE4B", grass: "#48D0B0",
    poison: "#A974BC", ghost: "#7B6CB3"
  };
  var DEX = [
    { id: 1, name: "Bulbasaur", types: ["grass", "poison"], stats: [45, 49, 49, 65, 65, 45] },
    { id: 4, name: "Charmander", types: ["fire"], stats: [39, 52, 43, 60, 50, 65] },
    { id: 7, name: "Squirtle", types: ["water"], stats: [44, 48, 65, 50, 64, 43] },
    { id: 25, name: "Pikachu", types: ["electric"], stats: [35, 55, 40, 50, 50, 90] },
    { id: 94, name: "Gengar", types: ["ghost", "poison"], stats: [60, 65, 60, 130, 75, 110] },
    { id: 133, name: "Eevee", types: ["normal"], stats: [55, 55, 50, 45, 65, 55] },
    { id: 6, name: "Charizard", types: ["fire"], stats: [78, 84, 78, 109, 85, 100] },
    { id: 9, name: "Blastoise", types: ["water"], stats: [79, 83, 100, 85, 105, 78] }
  ];
  var STAT_NAMES = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];

  function art(id) {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/" + id + ".png";
  }
  function dexNum(id) { return "#" + String(id).padStart(3, "0"); }

  function initDex() {
    var grid = document.getElementById("dex-grid");
    var list = document.getElementById("dex-list");
    var detail = document.getElementById("dex-detail");
    if (!grid || !detail) return;
    var back = document.getElementById("dex-back");
    var lastTile = null;

    DEX.forEach(function (p) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dex-tile";
      btn.style.setProperty("--type", TYPE_COLORS[p.types[0]]);
      btn.setAttribute("aria-label", p.name + ", " + p.types.join(" and ") + " type. Open details");
      btn.innerHTML =
        '<span class="dex-tile__num" aria-hidden="true">' + dexNum(p.id) + "</span>" +
        '<span class="dex-tile__name">' + p.name + "</span>" +
        '<span class="dex-tile__types" aria-hidden="true">' +
        p.types.map(function (t) { return '<span class="dex-badge">' + t + "</span>"; }).join("") +
        "</span>" +
        '<img src="' + art(p.id) + '" alt="" loading="lazy" width="66" height="66" onerror="this.remove()">';
      btn.addEventListener("click", function () { open(p, btn); });
      li.appendChild(btn);
      grid.appendChild(li);
    });

    function open(p, tile) {
      lastTile = tile;
      var color = TYPE_COLORS[p.types[0]];
      detail.style.setProperty("--type", color);
      document.getElementById("dex-detail-num").textContent = dexNum(p.id);
      var name = document.getElementById("dex-detail-name");
      name.textContent = p.name;
      document.getElementById("dex-detail-types").innerHTML = p.types
        .map(function (t) { return '<span class="dex-badge">' + t + "</span>"; }).join("");
      var img = document.getElementById("dex-detail-art");
      img.style.visibility = "visible";
      img.onerror = function () { img.style.visibility = "hidden"; };
      img.src = art(p.id);
      img.alt = "Official artwork of " + p.name;

      var max = 160;
      document.getElementById("dex-stats").innerHTML = p.stats.map(function (v, i) {
        var barColor = v >= 80 ? "#48D0B0" : v >= 55 ? "#FFCE4B" : "#FB6C6C";
        return "<dt>" + STAT_NAMES[i] + "</dt><dd>" + v + "</dd>" +
          '<dd class="dex-bar" aria-hidden="true"><span style="width:' + Math.min(100, (v / max) * 100) + "%;--bar:" + barColor + '"></span></dd>';
      }).join("");

      list.setAttribute("aria-hidden", "true");
      list.inert = true;
      detail.hidden = false;
      detail.scrollTop = 0;
      name.focus();
    }

    function close() {
      detail.hidden = true;
      list.removeAttribute("aria-hidden");
      list.inert = false;
      if (lastTile) lastTile.focus();
    }

    back.addEventListener("click", close);
    detail.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    });
  }

  /* ---------------- Just In Case UI kitchen sink ---------------- */

  function initSink() {
    var status = document.getElementById("sink-status");
    if (!status) return;

    function say(msg) { status.textContent = msg; }

    document.querySelectorAll(".jic-btn").forEach(function (b) {
      b.addEventListener("click", function () { say(b.getAttribute("data-say")); });
    });

    // Text input: validate when leaving the field, then live once an error is showing.
    var input = document.getElementById("jic-email");
    var err = document.getElementById("jic-email-error");
    var touched = false;
    function validate() {
      var v = input.value.trim();
      var msg = "";
      if (!v) msg = "Enter your work email.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = "Enter an email like name@company.com.";
      if (msg) {
        err.textContent = msg;
        err.hidden = false;
        input.setAttribute("aria-invalid", "true");
      } else {
        err.hidden = true;
        err.textContent = "";
        input.removeAttribute("aria-invalid");
      }
      return !msg;
    }
    input.addEventListener("blur", function () {
      touched = true;
      if (validate() && input.value) say("Email looks good.");
    });
    input.addEventListener("input", function () { if (touched) validate(); });

    // Dropdown (listbox pattern).
    var wrap = document.getElementById("jic-select");
    var trigger = document.getElementById("jic-size-btn");
    var listbox = document.getElementById("jic-size-list");
    var valueEl = document.getElementById("jic-size-value");
    var options = Array.prototype.slice.call(listbox.querySelectorAll('[role="option"]'));
    var active = 0;

    function setActive(i) {
      active = (i + options.length) % options.length;
      options.forEach(function (o, n) { o.classList.toggle("is-active", n === active); });
      listbox.setAttribute("aria-activedescendant", options[active].id);
    }
    function openList() {
      listbox.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      var sel = options.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; });
      setActive(sel >= 0 ? sel : 0);
      listbox.focus();
    }
    function closeList(returnFocus) {
      listbox.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (returnFocus) trigger.focus();
    }
    function choose(i) {
      options.forEach(function (o, n) { o.setAttribute("aria-selected", n === i ? "true" : "false"); });
      valueEl.textContent = options[i].textContent;
      closeList(true);
      say("Team size set to " + options[i].textContent.toLowerCase() + ".");
    }

    trigger.addEventListener("click", function () {
      if (listbox.hidden) openList(); else closeList(true);
    });
    trigger.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); }
    });
    listbox.addEventListener("keydown", function (e) {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); setActive(active + 1); break;
        case "ArrowUp": e.preventDefault(); setActive(active - 1); break;
        case "Home": e.preventDefault(); setActive(0); break;
        case "End": e.preventDefault(); setActive(options.length - 1); break;
        case "Enter":
        case " ": e.preventDefault(); choose(active); break;
        case "Escape": e.preventDefault(); closeList(true); break;
        case "Tab": closeList(false); break;
      }
    });
    options.forEach(function (o, i) {
      o.addEventListener("mousemove", function () { setActive(i); });
      o.addEventListener("click", function () { choose(i); });
    });
    document.addEventListener("pointerdown", function (e) {
      if (!listbox.hidden && !wrap.contains(e.target)) closeList(false);
    });
  }

  /* ---------------- Experience toggle ---------------- */

  function initExperienceToggle() {
    var panel = document.getElementById("experience-more");
    var btn = document.getElementById("experience-toggle");
    if (!panel || !btn) return;
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") !== "true";
      panel.classList.toggle("is-expanded", expanded);
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      panel.setAttribute("aria-hidden", expanded ? "false" : "true");
      btn.textContent = expanded ? "Hide earlier roles" : "Show earlier roles";
    });
  }

  function init() {
    setCopyrightYear();
    initClock();
    initHeader();
    initAmbient();
    initTrails();
    initDash();
    initDex();
    initSink();
    initExperienceToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
