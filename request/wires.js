(() => {
  "use strict";

  // Настройки — тюнить тут, без нырка в математику ниже.
  const CONFIG = {
    ribbonCount: 4,
    // "домашние" позиции — у каждого провода своя, но кластер компактный
    // (не широкие раздельные дорожки): общая волна ниже гарантированно
    // сводит их вместе достаточно часто, раз они и так рядом.
    homeXFractions: [0.1, 0.16, 0.22, 0.28],

    // Общая волна — как в двойной спирали ДНК: одна и та же частота и
    // амплитуда у всех, отличается только сдвиг фазы (по кругу, поровну).
    // Это даёт РЕГУЛЯРНОЕ, предсказуемое по времени пересечение соседей,
    // а не "рано или поздно, если повезёт с случайными частотами" —
    // на этом уже спотыкались в самой первой версии.
    braidAmp: 46, // px — размах общей волны
    braidSpeed: 0.34, // рад/сек — общая скорость для всех проводов сразу

    // Мелкое собственное дрожание поверх общей волны — только для
    // органичности/неидеальности, амплитуда заметно меньше braidAmp,
    // чтобы не портить регулярность пересечений.
    ownWobbleAmp: 8, // px

    halfWidth: 13, // толщина ленты (px) от центральной линии до края
    highlightWidthFactor: 0.4, // доля halfWidth, которую занимает блик
    cutoutMargin: 3, // на сколько px шире тела вырезаем "зазор" под верхним проводом

    // зона по вертикали: снизу уходят за край экрана, сверху гаснут
    // (сам fade — через CSS mask-image, здесь просто где рисовать)
    yTopFraction: 0.12,
    yBottomFraction: 1.08,
    samples: 60,

    color: { r: 60, g: 80, b: 104 },
    baseAlpha: 0.3,
    highlightAlpha: 0.36,
  };

  const canvas = document.querySelector(".opening__wires");
  const ctx = canvas.getContext("2d");
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Небольшой детерминированный PRNG — только для мелкого собственного
  // дрожания каждого провода, конфигурация одинаковая между перезагрузками.
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(1337);

  // envelope(f): 0 на краях (низ уходит за экран, верх гаснет в маске),
  // пик в середине видимого участка — вся "жизнь" провода сосредоточена
  // там, где она реально видна. Чисто пространственная функция, без t.
  function envelope(f) {
    return Math.sin(Math.PI * Math.min(Math.max(f, 0), 1));
  }

  // Провода: своя домашняя X + сдвиг фазы для общей волны + мелкое своё
  // дрожание. Никакого состояния/расписания — только константы.
  const ribbons = CONFIG.homeXFractions.map((frac, i) => ({
    id: i,
    homeXFraction: frac,
    phaseOffset: (i * Math.PI * 2) / CONFIG.ribbonCount,
    wobble: {
      amp: CONFIG.ownWobbleAmp * (0.7 + rand() * 0.6),
      phase: rand() * Math.PI * 2,
      speed: 0.08 + rand() * 0.08,
    },
  }));

  // x(f, t) = home + envelope(f) · [общая_волна(t) + своё_дрожание(t)]
  // Это строго произведение "форма по высоте" × "функция только от
  // времени" — ни в одном слагаемом нет f внутри временной части,
  // поэтому это честная стоячая волна: форма не едет вдоль провода,
  // меняется только её амплитуда/знак.
  function centerline(ribbon, t) {
    const points = [];
    const yTop = height * CONFIG.yTopFraction;
    const yBottom = height * CONFIG.yBottomFraction;
    const homeX = width * ribbon.homeXFraction;
    const w = ribbon.wobble;

    const braid = CONFIG.braidAmp * Math.cos(ribbon.phaseOffset + t * CONFIG.braidSpeed);
    const wobble = w.amp * Math.cos(w.phase + t * w.speed);

    for (let i = 0; i <= CONFIG.samples; i++) {
      const f = i / CONFIG.samples;
      const y = yBottom + (yTop - yBottom) * f;
      const env = envelope(f);
      const x = homeX + env * (braid + wobble);
      points.push({ x, y });
    }
    return points;
  }

  // depth(t) — тот же аргумент, что и в общей волне позиции, сдвинутый на
  // 90° (классический sin/cos трюк ДНК-спирали): глубина меняется ровно
  // с той же скоростью, что и само сближение проводов, поэтому "кто
  // спереди" не может переключиться посреди одного пересечения.
  function depth(ribbon, t) {
    return Math.cos(ribbon.phaseOffset + t * CONFIG.braidSpeed + Math.PI / 2);
  }

  function offsetEdges(points, halfWidth, bias = 0) {
    const left = [];
    const right = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const cx = points[i].x + nx * bias * halfWidth;
      const cy = points[i].y + ny * bias * halfWidth;
      left.push({ x: cx + nx * halfWidth, y: cy + ny * halfWidth });
      right.push({ x: cx - nx * halfWidth, y: cy - ny * halfWidth });
    }
    return { left, right };
  }

  function stripPath(left, right) {
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
  }

  function fillStrip(left, right, fillStyle) {
    stripPath(left, right);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawRibbonBody(ribbon, points) {
    const { r, g, b } = CONFIG.color;
    const body = offsetEdges(points, CONFIG.halfWidth);
    fillStrip(body.left, body.right, `rgba(${r}, ${g}, ${b}, ${CONFIG.baseAlpha})`);

    const hw = CONFIG.halfWidth * CONFIG.highlightWidthFactor;
    const highlight = offsetEdges(points, hw, 0.35);
    fillStrip(
      highlight.left,
      highlight.right,
      `rgba(${Math.min(r + 90, 255)}, ${Math.min(g + 90, 255)}, ${Math.min(b + 90, 255)}, ${CONFIG.highlightAlpha})`
    );
  }

  // Вырезает в уже нарисованном контенте "зазор" по контуру провода —
  // применяется ПЕРЕД тем, как рисовать провод, который должен быть
  // сверху, чтобы нижний не просвечивал/не сливался в месте пересечения.
  // Безвредно, если под ним ничего нет (вырезает по пустому месту).
  function cutGapFor(points) {
    const edges = offsetEdges(points, CONFIG.halfWidth + CONFIG.cutoutMargin);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    stripPath(edges.left, edges.right);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, width, height);

    // каждый кадр — просто сортируем по глубине и рисуем от дальних к
    // ближним, вырезая зазор перед каждым следующим. Никакого расписания,
    // никаких событий — постоянное состояние, пересчитанное с нуля.
    const items = ribbons
      .map((ribbon) => ({ ribbon, points: centerline(ribbon, t), depth: depth(ribbon, t) }))
      .sort((a, b) => a.depth - b.depth);

    for (const item of items) {
      cutGapFor(item.points);
      drawRibbonBody(item.ribbon, item.points);
    }
  }

  let start = null;
  function frame(ts) {
    if (start === null) start = ts;
    const t = (ts - start) / 1000;
    draw(t);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();

  if (prefersReducedMotion) {
    draw(0);
  } else {
    requestAnimationFrame(frame);
  }
})();
