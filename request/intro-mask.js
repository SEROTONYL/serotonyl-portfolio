(() => {
  "use strict";

  // Отступ вокруг измеренного бокса .opening__intro и ширина мягкого
  // перехода — см. docs/superpowers/specs/2026-08-04-intro-text-legibility-design.md,
  // таблица "Явные числа". PAD задаётся здесь (в JS), FEATHER — в CSS
  // (--intro-mask-feather в styles.css), поэтому здесь только PAD.
  const PAD = 20;

  const intro = document.querySelector(".opening__intro");
  // Та же коробка, что и у .opening__branch/.opening__foliage (оба —
  // inset: 0 внутри .opening) — берём любую из них как систему отсчёта.
  const container = document.querySelector(".opening__branch");
  const root = document.documentElement;

  function updateMaskBox() {
    if (!intro || !container) return;
    const rect = intro.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // .opening__intro скрыт/display:none — маску не трогаем
    // getBoundingClientRect() всегда viewport-relative, а стопы градиента
    // в mask-image на .opening__branch/.opening__foliage резолвятся в
    // локальных координатах САМОГО элемента (0..width/0..height его
    // border-box). Эти системы совпадают только при scrollY === 0 — при
    // скролле (см. @media (max-height: 480px) в styles.css, который явно
    // делает страницу прокручиваемой) расходятся на величину прокрутки.
    // Меряем containerRect тем же синхронным вызовом и вычитаем — тогда
    // общий сдвиг от скролла (он одинаков для intro и container, т.к. оба
    // элемента в одном документе) сокращается, и результат уже в системе
    // координат контейнера, как и ожидает CSS.
    const containerRect = container.getBoundingClientRect();
    root.style.setProperty("--intro-mask-left", `${rect.left - containerRect.left - PAD}px`);
    root.style.setProperty("--intro-mask-right", `${rect.right - containerRect.left + PAD}px`);
    root.style.setProperty("--intro-mask-top", `${rect.top - containerRect.top - PAD}px`);
    root.style.setProperty("--intro-mask-bottom", `${rect.bottom - containerRect.top + PAD}px`);
  }

  // Синхронизация с веткой/листвой — через то же событие, что уже держит
  // branch.js и foliage-3d.js в синхроне на resize (см. branch.js:170-174 и
  // design spec "Синхронизация"), а не отдельный resize-listener: иначе
  // бокс текста мог бы пересчитаться на кадр раньше/позже геометрии ветки.
  window.addEventListener("sakura-branch:render", updateMaskBox);

  // intro-mask.js подключён (см. index.html) как defer-скрипт ПЕРЕД
  // branch.js, поэтому этот вызов происходит до первого dispatch события
  // выше — статичный текстовый блок уже имеет финальные размеры к этому
  // моменту (defer гарантирует, что DOM разобран), так что дублирования
  // здесь для корректности не требуется, только для ясности порядка.
  updateMaskBox();
})();
