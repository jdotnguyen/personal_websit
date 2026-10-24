(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Small bits ---------------- */

  function setCopyrightYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = String(new Date().getFullYear());
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
      { off: -1.35, dir: 1, color: [255, 240, 215], day: [30, 70, 190] },
      { off: -0.85, dir: 1, color: [214, 232, 255], day: [37, 99, 235] },
      { off: -0.4, dir: 1, color: [235, 242, 255], day: [14, 52, 150] },
      { off: 0.3, dir: -1, color: [255, 40, 64], day: [220, 20, 60] },
      { off: 0.72, dir: -1, color: [255, 64, 52], day: [235, 70, 30] },
      { off: 1.15, dir: -1, color: [255, 30, 80], day: [190, 18, 100] }
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
      // Night: light adds up ("lighter"). Day: streaks are dark, saturated paint on a pale sky.
      var day = document.documentElement.getAttribute("data-theme") === "light";
      ctx.globalCompositeOperation = day ? "source-over" : "lighter";
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
            color = day ? [214, 110, 0] : [255, 170, 80];
            alpha = 0.3 + L.t * 0.4;
            width = 0.6 + p.scale * 1.4;
          } else {
            color = day ? lane.day : lane.color;
            alpha = Math.min(1, (day ? 0.5 : 0.4) + L.t * 0.9);
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

    function repaintForTheme() {
      ctx.clearRect(0, 0, w, h);
      lights.forEach(function (L) { L.prev = null; });
      if (reduceMotion) { drawStill(); return; }
      for (var n = 0; n < 130; n++) step(true); // warm up so the new colours are already streaking
    }
    window.addEventListener("themechange", repaintForTheme);

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

  /* ---------------- Pokédex: splash + app preview ---------------- */

  var TYPE_COLORS = {
    normal: "#A4ACAF", fire: "#FB6C6C", water: "#77BDFE", electric: "#FFCE4B", grass: "#48D0B0",
    ice: "#6FD3E6", fighting: "#E0865A", poison: "#A974BC", ground: "#D9B46B", flying: "#8FA8DD",
    psychic: "#F67FA1", bug: "#9CC24B", rock: "#BFAE6E", ghost: "#7B6CB3", dragon: "#7469E0",
    dark: "#6F6A75", steel: "#9FB4C4", fairy: "#EE99C9"
  };
  var DEX = [
    { id: 1, name: "Bulbasaur", types: ["grass", "poison"], stats: [45, 49, 49, 65, 65, 45] },
    { id: 4, name: "Charmander", types: ["fire"], stats: [39, 52, 43, 60, 50, 65] },
    { id: 7, name: "Squirtle", types: ["water"], stats: [44, 48, 65, 50, 64, 43] },
    { id: 25, name: "Pikachu", types: ["electric"], stats: [35, 55, 40, 50, 50, 90] },
    { id: 94, name: "Gengar", types: ["ghost", "poison"], stats: [60, 65, 60, 130, 75, 110] },
    { id: 133, name: "Eevee", types: ["normal"], stats: [55, 55, 50, 45, 65, 55] },
    { id: 6, name: "Charizard", types: ["fire", "flying"], stats: [78, 84, 78, 109, 85, 100] },
    { id: 9, name: "Blastoise", types: ["water"], stats: [79, 83, 100, 85, 105, 78] },
    { id: 39, name: "Jigglypuff", types: ["normal", "fairy"], stats: [115, 45, 20, 45, 25, 20] },
    { id: 54, name: "Psyduck", types: ["water"], stats: [50, 52, 48, 65, 50, 55] },
    { id: 58, name: "Growlithe", types: ["fire"], stats: [55, 70, 45, 70, 50, 60] },
    { id: 63, name: "Abra", types: ["psychic"], stats: [25, 20, 15, 105, 55, 90] }
  ];
  var STAT_NAMES = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];
  var EXPLORE = [
    ["Types", "All 18 types and how they match up", "#FB6C6C"],
    ["Regions", "Regional Pokédexes and where to find things", "#48D0B0"],
    ["Moves", "Search every move by type and category", "#E0865A"],
    ["Abilities", "What they do and who has them", "#6C79DB"],
    ["Items", "Every item, with held-by and effects", "#D9A92E"],
    ["Berries", "Growing, flavours and Natural Gift", "#9CC24B"],
    ["TMs & HMs", "Which move each one teaches", "#77BDFE"],
    ["Natures", "Which stats each nature raises and lowers", "#F67FA1"]
  ];
  var TOOLS = [
    ["Team matchups", "Shared weaknesses and coverage for up to 6", "#6C79DB"],
    ["Stat calculator", "Real stats from level, nature, IVs and EVs", "#E0865A"],
    ["Who’s that Pokémon?", "Name the silhouette. Track your streak", "#48D0B0", "quiz"],
    ["Compare", "Stats and type matchup, side by side", "#F67FA1"]
  ];
  var NOTES = {
    home: "Tap the card, shuffle, or try the quiz.",
    list: "Tap a Pokémon to open its detail screen.",
    favs: "Hearts from the detail screen land here.",
    explore: "Eight reference hubs in the real app.",
    tools: "Tap “Who’s that Pokémon?” to play.",
    quiz: "Pick the name. Streaks carry on.",
    detail: "Tap the heart to favourite it."
  };

  function art(id) {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/" + id + ".png";
  }
  function dexNum(id) { return "#" + String(id).padStart(3, "0"); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function badges(types) {
    return types.map(function (t) { return '<span class="dex-badge">' + t + "</span>"; }).join("");
  }
  function isLight(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function initSplash() {
    var splash = document.getElementById("dex-splash");
    if (!splash) return;

    splash.querySelectorAll(".splash__mon").forEach(function (img) {
      img.style.setProperty("--d", img.getAttribute("data-depth") || "1");
      img.onload = function () { img.classList.add("is-ready"); };
      img.onerror = function () { img.remove(); };
      img.src = art(img.getAttribute("data-art"));
    });

    var track = document.getElementById("dex-marquee");
    if (track) {
      var types = Object.keys(TYPE_COLORS);
      var html = "";
      for (var pass = 0; pass < 2; pass++) {
        types.forEach(function (t) {
          var c = TYPE_COLORS[t];
          html += '<span class="tchip" style="--c:' + c + ";color:" + (isLight(c) ? "#10131a" : "#fff") + '">' + t + "</span>";
        });
      }
      track.innerHTML = html;
    }

    if (reduceMotion) return;
    var raf = 0, nx = 0, ny = 0;
    splash.addEventListener("pointermove", function (e) {
      var r = splash.getBoundingClientRect();
      nx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ny = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        splash.style.setProperty("--px", nx.toFixed(3));
        splash.style.setProperty("--py", ny.toFixed(3));
      });
    });
    splash.addEventListener("pointerleave", function () {
      splash.style.setProperty("--px", "0");
      splash.style.setProperty("--py", "0");
    });
  }

  function initDex() {
    var screen = document.getElementById("dex-screen");
    if (!screen) return;
    var views = {
      home: document.getElementById("dex-home"),
      list: document.getElementById("dex-list"),
      favs: document.getElementById("dex-favs"),
      explore: document.getElementById("dex-explore"),
      tools: document.getElementById("dex-tools"),
      quiz: document.getElementById("dex-quiz"),
      detail: document.getElementById("dex-detail")
    };
    var heads = {
      home: "dex-greet", list: "dex-list-title", favs: "dex-favs-title", explore: "dex-explore-title",
      tools: "dex-tools-title", quiz: "dex-quiz-title", detail: "dex-detail-name"
    };
    var tabFor = { home: "home", list: "home", favs: "favs", explore: "explore", tools: "tools", quiz: "tools" };
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".dex-tab"));
    var note = document.getElementById("dex-note");
    var current = "home";
    var detailFrom = "home";
    var lastTile = null;
    var favs = [];
    try { favs = JSON.parse(localStorage.getItem("dexFavs") || "[]").filter(function (n) { return typeof n === "number"; }); } catch (e) {}

    function saveFavs() { try { localStorage.setItem("dexFavs", JSON.stringify(favs)); } catch (e) {} }
    function byId(id) { return DEX.filter(function (p) { return p.id === id; })[0]; }

    function show(name, opts) {
      opts = opts || {};
      current = name;
      Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
      screen.setAttribute("data-view", name);
      var tab = tabFor[name] || tabFor[detailFrom] || "home";
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-tab") === tab;
        t.classList.toggle("is-selected", on);
        if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
      });
      note.textContent = NOTES[name];
      views[name].scrollTop = 0;
      if (name === "favs") renderFavs();
      if (name === "quiz" && !quiz.current) nextQuiz();
      if (!opts.quiet) {
        var h = document.getElementById(heads[name]);
        if (h) h.focus({ preventScroll: true });
      }
    }

    /* ----- tiles ----- */
    function tile(p) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dex-tile";
      btn.style.setProperty("--type", TYPE_COLORS[p.types[0]]);
      btn.setAttribute("aria-label", p.name + ", " + p.types.join(" and ") + " type. Open details");
      btn.innerHTML =
        '<span class="dex-tile__num" aria-hidden="true">' + dexNum(p.id) + "</span>" +
        '<span class="dex-tile__name">' + p.name + "</span>" +
        '<span class="dex-tile__types" aria-hidden="true">' + badges(p.types) + "</span>" +
        '<img src="' + art(p.id) + '" alt="" loading="lazy" width="66" height="66" onerror="this.remove()">';
      btn.addEventListener("click", function () { lastTile = btn; openDetail(p); });
      li.appendChild(btn);
      return li;
    }
    var grid = document.getElementById("dex-grid");
    DEX.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (p) { grid.appendChild(tile(p)); });

    function renderFavs() {
      var ul = document.getElementById("dex-favs-grid");
      ul.innerHTML = "";
      favs.slice().reverse().forEach(function (id) { var p = byId(id); if (p) ul.appendChild(tile(p)); });
      document.getElementById("dex-favs-empty").hidden = favs.length > 0;
    }

    /* ----- home ----- */
    var now = new Date();
    var h = now.getHours();
    document.getElementById("dex-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    document.getElementById("dex-greet").textContent = h < 5 ? "Up late?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

    var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    var daily = DEX[dayOfYear % DEX.length];
    var dailyBtn = document.getElementById("dex-daily");
    var dailyArt = document.getElementById("dex-daily-art");

    function renderDaily(p, animate) {
      daily = p;
      dailyBtn.style.setProperty("--type", TYPE_COLORS[p.types[0]]);
      document.getElementById("dex-daily-name").textContent = p.name;
      document.getElementById("dex-daily-sub").textContent = dexNum(p.id);
      document.getElementById("dex-daily-types").innerHTML = badges(p.types);
      dailyBtn.setAttribute("aria-label", "Pokémon of the day: " + p.name + ". Open details");
      dailyArt.onerror = function () { dailyArt.style.visibility = "hidden"; };
      dailyArt.style.visibility = "visible";
      dailyArt.src = art(p.id);
      if (animate && !reduceMotion) {
        dailyArt.classList.remove("is-pop");
        void dailyArt.offsetWidth;
        dailyArt.classList.add("is-pop");
      }
      var best = 0;
      p.stats.forEach(function (v, i) { if (v > p.stats[best]) best = i; });
      var total = p.stats.reduce(function (a, b) { return a + b; }, 0);
      document.getElementById("dex-fact").textContent =
        p.name + "’s best base stat is " + STAT_NAMES[best] + " at " + p.stats[best] + ", and its stats add up to " + total + ".";
    }
    renderDaily(daily, false);
    dailyBtn.addEventListener("click", function () { lastTile = dailyBtn; openDetail(daily); });
    document.getElementById("dex-shuffle").addEventListener("click", function () {
      var next;
      do { next = DEX[Math.floor(Math.random() * DEX.length)]; } while (next === daily);
      renderDaily(next, true);
      note.textContent = "Today’s pick: " + next.name + ".";
    });

    /* ----- hubs ----- */
    function hubs(ul, list) {
      list.forEach(function (item) {
        var li = document.createElement("li");
        var inner = '<span><span class="hub__title">' + item[0] + '</span><span class="hub__sub">' + item[1] + '</span></span><span class="hub__go" aria-hidden="true">›</span>';
        var el;
        if (item[3]) {
          el = document.createElement("button");
          el.type = "button";
          el.setAttribute("data-goto", item[3]);
        } else {
          el = document.createElement("div");
        }
        el.className = "hub";
        el.style.setProperty("--c", item[2]);
        el.innerHTML = inner;
        li.appendChild(el);
        ul.appendChild(li);
      });
    }
    hubs(document.getElementById("dex-explore-list"), EXPLORE);
    hubs(document.getElementById("dex-tools-list"), TOOLS);

    /* ----- navigation ----- */
    screen.addEventListener("click", function (e) {
      var go = e.target.closest("[data-goto]");
      if (go) { show(go.getAttribute("data-goto")); return; }
      var tab = e.target.closest(".dex-tab");
      if (tab) show(tab.getAttribute("data-tab"));
    });

    /* ----- detail ----- */
    var heart = document.getElementById("dex-heart");
    var openId = null;
    function syncHeart() {
      var on = favs.indexOf(openId) !== -1;
      heart.setAttribute("aria-pressed", on ? "true" : "false");
      heart.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
    }
    heart.addEventListener("click", function () {
      var i = favs.indexOf(openId);
      if (i === -1) favs.push(openId); else favs.splice(i, 1);
      saveFavs();
      syncHeart();
      note.textContent = i === -1 ? "Added to Favourites." : "Removed from Favourites.";
    });

    function openDetail(p) {
      detailFrom = current === "detail" ? detailFrom : current;
      openId = p.id;
      var color = TYPE_COLORS[p.types[0]];
      views.detail.style.setProperty("--type", color);
      document.getElementById("dex-detail-num").textContent = dexNum(p.id);
      document.getElementById("dex-detail-name").textContent = p.name;
      document.getElementById("dex-detail-types").innerHTML = badges(p.types);
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
      }).join("") ;
      var total = p.stats.reduce(function (a, b) { return a + b; }, 0);
      var totalEl = document.getElementById("dex-total");
      if (!totalEl) {
        totalEl = document.createElement("p");
        totalEl.id = "dex-total";
        totalEl.className = "dex-detail__total";
        document.getElementById("dex-stats").insertAdjacentElement("afterend", totalEl);
      }
      totalEl.innerHTML = "Total <strong>" + total + "</strong>";
      syncHeart();
      show("detail");
    }
    function closeDetail() {
      show(detailFrom, { quiet: true });
      if (lastTile && document.body.contains(lastTile) && !lastTile.closest("[hidden]")) lastTile.focus();
    }
    document.getElementById("dex-back").addEventListener("click", closeDetail);
    views.detail.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeDetail(); }
    });

    /* ----- quiz: who's that Pokémon? ----- */
    var quiz = { current: null, last: null, streak: 0, best: 0, answered: false };
    var stage = document.getElementById("quiz-stage");
    var qImg = document.getElementById("quiz-img");
    var qOpts = document.getElementById("quiz-options");
    var qResult = document.getElementById("quiz-result");
    var qNext = document.getElementById("quiz-next");

    function scoreboard() {
      document.getElementById("quiz-streak").textContent = quiz.streak;
      document.getElementById("quiz-best").textContent = quiz.best;
    }
    function nextQuiz() {
      var p;
      do { p = DEX[Math.floor(Math.random() * DEX.length)]; } while (p === quiz.last);
      quiz.current = p; quiz.last = p; quiz.answered = false;
      var choices = shuffle([p].concat(shuffle(DEX.filter(function (d) { return d !== p; })).slice(0, 3)));
      stage.classList.remove("is-revealed");
      qImg.style.visibility = "visible";
      qImg.onerror = function () { qImg.style.visibility = "hidden"; };
      qImg.alt = "Silhouette of a mystery Pokémon";
      qImg.src = art(p.id);
      qOpts.innerHTML = "";
      choices.forEach(function (c) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "quiz-opt";
        b.textContent = c.name;
        b.addEventListener("click", function () { answer(c, b); });
        qOpts.appendChild(b);
      });
      qResult.textContent = "";
      qNext.hidden = true;
      scoreboard();
    }
    function answer(choice, btn) {
      if (quiz.answered) return;
      quiz.answered = true;
      var right = choice === quiz.current;
      Array.prototype.forEach.call(qOpts.children, function (b) {
        b.disabled = true;
        if (b.textContent === quiz.current.name) b.classList.add("is-right");
      });
      if (right) {
        quiz.streak++;
        quiz.best = Math.max(quiz.best, quiz.streak);
        qResult.textContent = "Correct! It’s " + quiz.current.name + ".";
      } else {
        btn.classList.add("is-wrong");
        quiz.streak = 0;
        qResult.textContent = "Not quite. It’s " + quiz.current.name + ".";
      }
      qImg.alt = "Official artwork of " + quiz.current.name;
      stage.classList.add("is-revealed");
      scoreboard();
      qNext.hidden = false;
      qNext.focus();
    }
    qNext.addEventListener("click", function () {
      nextQuiz();
      var first = qOpts.firstElementChild;
      if (first) first.focus();
    });
    views.quiz.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); show("tools"); }
    });
    views.list.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); show("home"); }
    });

    show("home", { quiet: true });
  }

  /* ---------------- Just In Case UI gallery ---------------- */

  var COMPONENTS = [
    "Accordion", "Alert", "Badge", "Breadcrumbs", "Button", "Checkbox", "Combobox", "Dialog",
    "Dropdown", "Link", "Menu", "Pagination", "PasswordInput", "Popover", "Progress", "RadioGroup",
    "SearchInput", "Spinner", "Switch", "Tabs", "TextInput", "Textarea", "Toast", "Tooltip"
  ];

  function initSink() {
    var sink = document.getElementById("sink");
    var status = document.getElementById("sink-status");
    if (!sink || !status) return;
    function $(id) { return document.getElementById(id); }
    function say(msg) { status.textContent = msg; }

    /* ----- toasts ----- */
    var toastHost = $("toasts");
    var ICONS = { success: "✓", danger: "!", info: "i" };
    function toast(tone, title, msg) {
      var t = document.createElement("div");
      t.className = "jic-toast jic-toast--" + tone;
      t.innerHTML = '<span class="jic-toast__ico" aria-hidden="true">' + ICONS[tone] + "</span>" +
        "<p><strong></strong><span></span></p>" +
        '<button type="button" aria-label="Dismiss notification">✕</button>';
      t.querySelector("strong").textContent = title;
      t.querySelector("p span").textContent = msg || "";
      var timer;
      function remove() {
        clearTimeout(timer);
        if (!t.parentNode) return;
        t.classList.add("is-leaving");
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, reduceMotion ? 0 : 230);
      }
      function arm() { timer = setTimeout(remove, 5000); }
      t.addEventListener("mouseenter", function () { clearTimeout(timer); });
      t.addEventListener("mouseleave", arm);
      t.querySelector("button").addEventListener("click", remove);
      toastHost.appendChild(t);
      while (toastHost.children.length > 4) toastHost.removeChild(toastHost.firstChild);
      arm();
    }
    sink.querySelectorAll("[data-toast]").forEach(function (b) {
      b.addEventListener("click", function () {
        var tone = b.getAttribute("data-toast");
        var copy = {
          success: ["Saved", "Your changes are live."],
          info: ["Syncing in the background", "You can keep working."],
          danger: ["Couldn’t send", "Check your connection and try again."]
        }[tone];
        toast(tone, copy[0], copy[1]);
        say(copy[0] + ". " + copy[1]);
      });
    });

    /* ----- group tabs ----- */
    var gtabs = Array.prototype.slice.call(sink.querySelectorAll("#gtabs [role=tab]"));
    function selectTab(tab, focus) {
      gtabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    }
    gtabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { selectTab(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = gtabs[(i + 1) % gtabs.length];
        if (e.key === "ArrowLeft") next = gtabs[(i - 1 + gtabs.length) % gtabs.length];
        if (e.key === "Home") next = gtabs[0];
        if (e.key === "End") next = gtabs[gtabs.length - 1];
        if (next) { e.preventDefault(); selectTab(next, true); }
      });
    });

    /* ----- theme lab ----- */
    var swatches = Array.prototype.slice.call(sink.querySelectorAll("#swatches [role=radio]"));
    var radius = $("radius");
    var code = $("lab-code");
    var accent = "#3b6fd4";
    function syncCode() {
      code.textContent = "--jic-color-action: " + accent + "; --jic-radius-control: " + radius.value + "px;";
      $("radius-out").textContent = radius.value + "px";
    }
    function pickSwatch(sw, focus) {
      swatches.forEach(function (s) {
        var on = s === sw;
        s.setAttribute("aria-checked", on ? "true" : "false");
        s.tabIndex = on ? 0 : -1;
      });
      accent = sw.getAttribute("data-accent");
      sink.style.setProperty("--a", accent);
      if (focus) sw.focus();
      syncCode();
    }
    swatches.forEach(function (sw, i) {
      sw.tabIndex = i === 0 ? 0 : -1;
      sw.addEventListener("click", function () { pickSwatch(sw, false); say("Action colour: " + sw.getAttribute("aria-label").toLowerCase() + "."); });
      sw.addEventListener("keydown", function (e) {
        var n = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") n = swatches[(i + 1) % swatches.length];
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = swatches[(i - 1 + swatches.length) % swatches.length];
        if (n) { e.preventDefault(); pickSwatch(n, true); say("Action colour: " + n.getAttribute("aria-label").toLowerCase() + "."); }
      });
    });
    radius.addEventListener("input", function () {
      sink.style.setProperty("--r", radius.value + "px");
      syncCode();
    });
    syncCode();

    /* ----- buttons ----- */
    var save = $("btn-save");
    sink.querySelectorAll(".jic-btn[data-say]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b === save) return;
        say(b.getAttribute("data-say"));
      });
    });
    save.addEventListener("click", function () {
      if (save.getAttribute("aria-busy") === "true") return;
      var spin = save.querySelector(".jic-spin");
      var label = save.querySelector("span");
      save.setAttribute("aria-busy", "true");
      spin.hidden = false;
      label.textContent = "Saving…";
      say("Saving…");
      setTimeout(function () {
        save.removeAttribute("aria-busy");
        spin.hidden = true;
        label.textContent = "Save changes";
        say("Changes saved.");
        toast("success", "Saved", "Your changes are live.");
      }, 1300);
    });

    /* ----- text input ----- */
    var input = $("jic-email");
    var err = $("jic-email-error");
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

    /* ----- password ----- */
    var pw = $("jic-pw");
    var pwBtn = $("pw-toggle");
    var meter = $("pw-meter");
    var LEVELS = [["Empty", "enter a password"], ["Weak", "weak"], ["Fair", "fair"], ["Good", "good"], ["Strong", "strong"]];
    var LEVEL_COLORS = ["#c53b3b", "#c53b3b", "#a8610a", "var(--a)", "#1d6b3f"];
    pwBtn.addEventListener("click", function () {
      var show = pw.type === "password";
      pw.type = show ? "text" : "password";
      pwBtn.setAttribute("aria-pressed", show ? "true" : "false");
      pwBtn.firstChild.textContent = show ? "Hide" : "Show";
      say(show ? "Password is visible." : "Password is hidden.");
    });
    pw.addEventListener("input", function () {
      var v = pw.value;
      var score = 0;
      if (v.length >= 8) score++;
      if (v.length >= 12) score++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      if (!v) score = 0; else score = Math.max(1, score);
      $("pw-bar").style.width = score * 25 + "%";
      $("pw-bar").style.background = LEVEL_COLORS[score];
      $("pw-meter-text").textContent = LEVELS[score][1];
      meter.setAttribute("aria-valuenow", String(score));
      meter.setAttribute("aria-valuetext", LEVELS[score][0]);
    });

    /* ----- search ----- */
    var search = $("jic-search");
    var clear = $("search-clear");
    var list = $("comp-list");
    var count = $("search-count");
    function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function renderComps() {
      var q = search.value.trim().toLowerCase();
      var hits = COMPONENTS.filter(function (c) { return !q || c.toLowerCase().indexOf(q) !== -1; });
      list.innerHTML = hits.map(function (c) {
        var i = q ? c.toLowerCase().indexOf(q) : -1;
        var label = i < 0 ? esc(c) : esc(c.slice(0, i)) + "<mark>" + esc(c.slice(i, i + q.length)) + "</mark>" + esc(c.slice(i + q.length));
        return "<li>" + label + "</li>";
      }).join("");
      count.textContent = hits.length === 0 ? "No components match “" + search.value.trim() + "”." : hits.length + (hits.length === 1 ? " component" : " components");
      clear.hidden = !search.value;
    }
    search.addEventListener("input", renderComps);
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && search.value) { e.preventDefault(); search.value = ""; renderComps(); }
    });
    clear.addEventListener("click", function () { search.value = ""; renderComps(); search.focus(); });
    renderComps();

    /* ----- switches, checkbox, radios ----- */
    $("sw-motion").addEventListener("change", function (e) {
      sink.setAttribute("data-calm", e.target.checked ? "true" : "false");
      say(e.target.checked ? "Calm motion on. Animations in this gallery are switched off." : "Calm motion off.");
    });
    $("sw-news").addEventListener("change", function (e) { say("Product updates " + (e.target.checked ? "on." : "off.")); });
    $("chk-terms").addEventListener("change", function (e) { say(e.target.checked ? "Terms accepted." : "Terms not accepted."); });
    sink.querySelectorAll('input[name="plan"]').forEach(function (r) {
      r.addEventListener("change", function () { say("Plan set to " + r.value + "."); });
    });

    /* ----- dropdown ----- */
    var wrap = $("jic-select");
    var trigger = $("jic-size-btn");
    var listbox = $("jic-size-list");
    var valueEl = $("jic-size-value");
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
    trigger.addEventListener("click", function () { if (listbox.hidden) openList(); else closeList(true); });
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

    /* ----- navigation: crumbs, pagination, accordion ----- */
    sink.querySelectorAll("[data-demo]").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); say("Would go to " + a.textContent + "."); });
    });

    var pages = $("pages");
    var TOTAL = 12, page = 4;
    function pageList() {
      var set = [1, TOTAL, page - 1, page, page + 1].filter(function (n) { return n >= 1 && n <= TOTAL; });
      set = set.filter(function (n, i) { return set.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
      var out = [];
      set.forEach(function (n, i) {
        if (i && n - set[i - 1] > 1) out.push("gap");
        out.push(n);
      });
      return out;
    }
    function renderPages(focusKey) {
      var html = '<li><button type="button" data-p="prev"' + (page === 1 ? " disabled" : "") + ' aria-label="Previous page">‹</button></li>';
      pageList().forEach(function (n) {
        if (n === "gap") html += '<li class="gap" aria-hidden="true">…</li>';
        else html += '<li><button type="button" data-p="' + n + '"' + (n === page ? ' aria-current="page"' : "") + ' aria-label="Page ' + n + (n === page ? ", current page" : "") + '">' + n + "</button></li>";
      });
      html += '<li><button type="button" data-p="next"' + (page === TOTAL ? " disabled" : "") + ' aria-label="Next page">›</button></li>';
      pages.innerHTML = html;
      $("pages-status").textContent = "Page " + page + " of " + TOTAL;
      if (focusKey) {
        var target = pages.querySelector('[data-p="' + focusKey + '"]:not(:disabled)') || pages.querySelector('[aria-current="page"]');
        if (target) target.focus();
      }
    }
    pages.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || b.disabled) return;
      var k = b.getAttribute("data-p");
      if (k === "prev") { page--; renderPages("prev"); }
      else if (k === "next") { page++; renderPages("next"); }
      else { page = parseInt(k, 10); renderPages(k); }
    });
    renderPages();

    sink.querySelectorAll(".jic-acc__btn").forEach(function (b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-expanded", b.getAttribute("aria-expanded") === "true" ? "false" : "true");
      });
    });

    /* ----- feedback: progress, alerts ----- */
    var upBtn = $("up-run"), upBar = $("up-bar"), upVal = $("up-val"), upTrack = $("up-track");
    function setUp(v) {
      upBar.style.width = v + "%";
      upVal.textContent = v + "%";
      upTrack.setAttribute("aria-valuenow", String(v));
    }
    upBtn.addEventListener("click", function () {
      var v = 0;
      upBtn.disabled = true;
      say("Upload started.");
      setUp(0);
      var iv = setInterval(function () {
        v = Math.min(100, v + 4 + Math.floor(Math.random() * 11));
        setUp(v);
        if (v >= 100) {
          clearInterval(iv);
          upBtn.disabled = false;
          upBtn.textContent = "Run it again";
          say("Upload complete.");
          toast("success", "Upload complete", "12 photos added.");
        }
      }, 200);
    });

    var alerts = $("alerts");
    var alertsHtml = alerts.innerHTML;
    var reset = $("alerts-reset");
    alerts.addEventListener("click", function (e) {
      var x = e.target.closest(".jic-alert__x");
      if (!x) return;
      var a = x.closest(".jic-alert");
      var next = a.nextElementSibling || a.previousElementSibling;
      a.classList.add("is-leaving");
      setTimeout(function () {
        a.remove();
        if (!alerts.children.length) {
          reset.hidden = false;
          reset.focus();
        } else if (next) {
          var nx = next.querySelector(".jic-alert__x");
          if (nx) nx.focus();
        }
      }, reduceMotion ? 0 : 200);
      say("Alert dismissed.");
    });
    reset.addEventListener("click", function () {
      alerts.innerHTML = alertsHtml;
      reset.hidden = true;
      alerts.querySelector(".jic-alert__x").focus();
      say("Alerts restored.");
    });

    /* ----- overlays: dialog, popover, menu ----- */
    var dlg = $("dlg");
    var dlgOpen = $("dlg-open");
    dlgOpen.addEventListener("click", function () {
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      $("dlg-cancel").focus();
    });
    $("dlg-cancel").addEventListener("click", function () { dlg.close(); say("Project kept."); });
    $("dlg-confirm").addEventListener("click", function () {
      dlg.close();
      say("Project deleted.");
      toast("danger", "Project deleted", "“Night Drive” is gone.");
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });

    var popBtn = $("pop-btn"), pop = $("pop-panel");
    function setPop(open) {
      pop.hidden = !open;
      popBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    popBtn.addEventListener("click", function () { setPop(pop.hidden); });
    pop.addEventListener("keydown", function (e) { if (e.key === "Escape") { setPop(false); popBtn.focus(); } });
    popBtn.addEventListener("keydown", function (e) { if (e.key === "Escape") setPop(false); });

    var menuBtn = $("menu-btn"), menuList = $("menu-list");
    var items = Array.prototype.slice.call(menuList.querySelectorAll("[role=menuitem]"));
    function openMenu(focusIndex) {
      menuList.hidden = false;
      menuBtn.setAttribute("aria-expanded", "true");
      items[focusIndex || 0].focus();
    }
    function closeMenu(returnFocus) {
      menuList.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
      if (returnFocus) menuBtn.focus();
    }
    menuBtn.addEventListener("click", function () { if (menuList.hidden) openMenu(0); else closeMenu(false); });
    menuBtn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); openMenu(0); }
      if (e.key === "ArrowUp") { e.preventDefault(); openMenu(items.length - 1); }
    });
    menuList.addEventListener("keydown", function (e) {
      var i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
      else if (e.key === "Tab") closeMenu(false);
    });
    items.forEach(function (it) {
      it.addEventListener("click", function () {
        closeMenu(true);
        say(it.textContent + " chosen.");
      });
    });

    document.addEventListener("pointerdown", function (e) {
      if (!listbox.hidden && !wrap.contains(e.target)) closeList(false);
      if (!pop.hidden && !pop.contains(e.target) && e.target !== popBtn) setPop(false);
      if (!menuList.hidden && !menuList.contains(e.target) && !menuBtn.contains(e.target)) closeMenu(false);
    });
    // Leaving a tab closes anything left open.
    gtabs.forEach(function (t) { t.addEventListener("click", function () { setPop(false); closeMenu(false); closeList(false); }); });
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

  /* ---------------- Theme toggle ---------------- */

  function initTheme() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var root = document.documentElement;
    var meta = document.querySelector('meta[name="theme-color"]');

    function current() {
      return root.getAttribute("data-theme") === "light" ? "light" : "dark";
    }
    function apply(theme) {
      root.setAttribute("data-theme", theme);
      btn.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
      if (meta) meta.setAttribute("content", theme === "light" ? "#f4f6fc" : "#060a18");
      try { localStorage.setItem("theme", theme); } catch (e) {}
      window.dispatchEvent(new Event("themechange"));
    }

    // Sync the switch with whatever the head script applied.
    btn.setAttribute("aria-pressed", current() === "light" ? "true" : "false");
    if (meta) meta.setAttribute("content", current() === "light" ? "#f4f6fc" : "#060a18");

    btn.addEventListener("click", function () {
      var next = current() === "light" ? "dark" : "light";
      if (!document.startViewTransition || reduceMotion) {
        apply(next);
        return;
      }
      var r = btn.getBoundingClientRect();
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      var vt = document.startViewTransition(function () { apply(next); });
      vt.ready.then(function () {
        root.animate(
          { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + radius + "px at " + x + "px " + y + "px)"] },
          { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
        );
      }).catch(function () {});
    });
  }

  function init() {
    setCopyrightYear();
    initTheme();
    initHeader();
    initAmbient();
    initTrails();
    initDash();
    initSplash();
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
