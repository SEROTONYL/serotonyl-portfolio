(() => {
  "use strict";

  const panel = document.getElementById("reveal-panel");
  const revealTiles = document.querySelectorAll(".tile--reveal");
  const contents = document.querySelectorAll(".reveal-panel__content");

  // Bumped on every open/close/swap so a transitionend callback from an
  // interrupted swap (fast double-click) can tell it's stale and no-op
  // instead of clobbering whatever state a newer action already set.
  let swapToken = 0;

  // With reduced motion, .reveal-panel__content has `transition: none`
  // (styles.css) — opacity changes are instant and transitionend never
  // fires, so swapContent must not wait for it (see fix report).
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  function isPanelOpen() {
    return panel.classList.contains("reveal-panel--open");
  }

  function closePanel() {
    swapToken += 1;
    panel.classList.remove("reveal-panel--open");
    revealTiles.forEach((tile) => tile.setAttribute("aria-expanded", "false"));
    const onPanelTransitionEnd = (event) => {
      if (event.target !== panel) {
        // content opacity fades bubble up through this listener too — ignore them
        return;
      }
      panel.removeEventListener("transitionend", onPanelTransitionEnd);
      if (!panel.classList.contains("reveal-panel--open")) {
        panel.hidden = true;
      }
    };
    panel.addEventListener("transitionend", onPanelTransitionEnd);
  }

  function showContentImmediate(key) {
    contents.forEach((content) => {
      content.classList.remove("reveal-panel__content--fade-out");
      content.hidden = content.dataset.revealContent !== key;
    });
  }

  function swapContent(key) {
    const current = Array.from(contents).find((content) => !content.hidden);
    const next = Array.from(contents).find((content) => content.dataset.revealContent === key);
    swapToken += 1;
    if (!current || current === next || prefersReducedMotion) {
      showContentImmediate(key);
      return;
    }
    const token = swapToken;
    current.classList.add("reveal-panel__content--fade-out");
    current.addEventListener(
      "transitionend",
      () => {
        if (token !== swapToken) {
          return;
        }
        current.hidden = true;
        current.classList.remove("reveal-panel__content--fade-out");
        next.classList.add("reveal-panel__content--fade-out");
        next.hidden = false;
        // force reflow so the fade-in transition runs even though the
        // fade-out class was just added in this same tick
        void next.offsetHeight;
        next.classList.remove("reveal-panel__content--fade-out");
      },
      { once: true }
    );
  }

  function openPanel(tile, key) {
    swapToken += 1;
    panel.hidden = false;
    // force reflow so the transform transition runs even if the panel
    // was just un-hidden in this same tick
    void panel.offsetHeight;
    panel.classList.add("reveal-panel--open");
    showContentImmediate(key);
    revealTiles.forEach((t) => t.setAttribute("aria-expanded", String(t === tile)));
  }

  revealTiles.forEach((tile) => {
    tile.addEventListener("click", () => {
      const key = tile.dataset.reveal;
      const isOpen = tile.getAttribute("aria-expanded") === "true";
      if (isOpen) {
        closePanel();
      } else if (isPanelOpen()) {
        swapContent(key);
        revealTiles.forEach((t) => t.setAttribute("aria-expanded", String(t === tile)));
      } else {
        openPanel(tile, key);
      }
    });
  });
})();
