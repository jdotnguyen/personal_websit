(function () {
  "use strict";

  function setCopyrightYear() {
    var el = document.getElementById("year");
    if (el) {
      el.textContent = String(new Date().getFullYear());
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function initScrollReveals() {
    var nodes = document.querySelectorAll(".reveal-when-ready");
    if (!nodes.length) {
      return;
    }

    if (prefersReducedMotion()) {
      nodes.forEach(function (n) {
        n.classList.add("is-visible");
      });
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -32px 0px" }
    );

    nodes.forEach(function (n) {
      io.observe(n);
    });
  }

  function setStatFinal(el) {
    var target = el.getAttribute("data-count-target");
    var suffix = el.getAttribute("data-count-suffix");
    if (suffix === null) {
      suffix = "";
    }
    el.textContent = String(target) + suffix;
  }

  function animateStat(el, durationMs) {
    var target = parseInt(el.getAttribute("data-count-target"), 10);
    var suffix = el.getAttribute("data-count-suffix");
    if (suffix === null) {
      suffix = "";
    }
    if (isNaN(target)) {
      return;
    }

    var start = performance.now();
    durationMs = durationMs || 1100;

    function tick(now) {
      var elapsed = now - start;
      var p = Math.min(1, elapsed / durationMs);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.round(eased * target);
      el.textContent = String(val) + suffix;
      if (p < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  function initStatCounters() {
    var strip = document.querySelector(".stats-strip");
    var nums = document.querySelectorAll(".stat-block__num");
    if (!strip || !nums.length) {
      return;
    }

    if (prefersReducedMotion()) {
      nums.forEach(setStatFinal);
      return;
    }

    var ran = false;
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || ran) {
            return;
          }
          ran = true;
          nums.forEach(function (el) {
            animateStat(el, 1150);
          });
          io.unobserve(strip);
        });
      },
      { threshold: 0.35 }
    );

    io.observe(strip);
  }

  function initExperienceToggle() {
    var panel = document.getElementById("experience-more");
    var btn = document.getElementById("experience-toggle");
    if (!panel || !btn) {
      return;
    }

    function setExpanded(expanded) {
      panel.classList.toggle("is-expanded", expanded);
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      panel.setAttribute("aria-hidden", expanded ? "false" : "true");
      btn.textContent = expanded ? "View less" : "View more";
    }

    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      setExpanded(!expanded);
    });
  }

  function init() {
    setCopyrightYear();
    initScrollReveals();
    initStatCounters();
    initExperienceToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
