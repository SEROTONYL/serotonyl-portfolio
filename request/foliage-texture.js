(function (root) {
  "use strict";

  const { mulberry32 } = root.SakuraBranchGeometry;

  // Монохромная база — тот же CONFIG.color, что и у ствола/скелета
  // (rgb(48,64,88)). Вся "светотень" кластера — это осветление/затемнение
  // ЭТОГО цвета, не переход к другому оттенку (design spec "Цвет": никакого
  // sakura-pink в этой сессии).
  const BASE_COLOR = { r: 48, g: 64, b: 88 };

  function mixColor(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
    };
  }

  // shade(t): t=0.5 -> base color unchanged. t<0.5 -> darker (shadow),
  // t>0.5 -> lighter (highlight). Same base color throughout, only
  // lightness varies - this is the "layered opacity for depth" technique
  // from the design spec's painting research (dark undercoat -> lighter
  // top -> pale highlight), done via lightness mixing instead of alpha
  // stacking so it stays controllable per-petal.
  function shade(t) {
    if (t <= 0.5) {
      const c = mixColor({ r: 8, g: 11, b: 16 }, BASE_COLOR, t / 0.5);
      return `rgb(${c.r}, ${c.g}, ${c.b})`;
    }
    const c = mixColor(BASE_COLOR, { r: 255, g: 255, b: 255 }, (t - 0.5) / 0.5);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }

  // Обратнояйцевидный лепесток с выемкой на кончике (design spec
  // "Форма лепестка"), не острая лилия-капля. Рисуется от базы (0,0)
  // вверх вдоль +Y; вызывающий код поворачивает/смещает через ctx.translate
  // + ctx.rotate до вызова.
  function tracePetal(ctx, length, width) {
    const halfW = width / 2;
    // Выемка заметно глубже и шире стартовых 0.14/0.86: на реальном экране
    // карточка ~40-60px, т.е. лепесток ~20px, и выемка в 14% ширины уходила
    // в субпиксель — кластер читался как остроконечная снежинка, а не как
    // цветок с надрезанными кончиками (Task 8). Контрольные точки основания
    // сдвинуты наружу (1.05 -> 0.72 / 1.02), чтобы лепесток был
    // обратнояйцевидным — узкий у базы, самый широкий ближе к кончику,
    // — а не ромбом с максимумом ширины у середины.
    const notch = width * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-halfW * 0.72, length * 0.26, -halfW * 1.02, length * 0.74, -notch, length * 0.96);
    ctx.quadraticCurveTo(0, length * 0.78, notch, length * 0.96);
    ctx.bezierCurveTo(halfW * 1.02, length * 0.74, halfW * 0.72, length * 0.26, 0, 0);
    ctx.closePath();
  }

  function drawFlower(ctx, cx, cy, petalLength, petalWidth, rng) {
    const petalCount = 5;
    const baseRotation = rng() * Math.PI * 2;
    for (let i = 0; i < petalCount; i++) {
      const angle = baseRotation + (i / petalCount) * Math.PI * 2 + (rng() * 2 - 1) * 0.12;
      const len = petalLength * (0.92 + rng() * 0.16);
      const wid = petalWidth * (0.9 + rng() * 0.2);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      const grad = ctx.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0, shade(0.32));
      grad.addColorStop(0.55, shade(0.62));
      grad.addColorStop(1, shade(0.88));
      ctx.fillStyle = grad;
      tracePetal(ctx, len, wid);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.fillStyle = shade(0.2);
    ctx.arc(cx, cy, petalWidth * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  // Подслой просвета (design spec "Translucency-подсветка") — мягкий
  // radial-градиент светлого оттенка ПОД цветками, шире их силуэта, чтобы
  // при контровом свете сцены казалось, что кластер светится изнутри, а не
  // залит плоско.
  function drawTranslucency(ctx, cx, cy, radius) {
    // Радиус подсветки держим ВНУТРИ силуэта цветка (см. вызов), а альфу —
    // низкой. Иначе (Task 8, визуальная проверка) ореол выходил за пределы
    // лепестков широким полупрозрачным диском: сам по себе он на светлом
    // фоне почти не виден, но при перекрытии карточек его край обрезался
    // z-буфером соседней карточки и читался как яркий белый серп с жёсткой
    // круглой границей — самый заметный артефакт всего рендера.
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    grad.addColorStop(0.6, "rgba(255, 255, 255, 0.06)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Одна карточка = мини-corymb (2-4 цветка), не один цветок (design spec
  // "Архитектура рендера"): меньше инстансов на ту же плотность, и
  // "как цветки перекрывают друг друга" решается один раз тут, а не
  // каждый раз случайно на рантайм-размещении.
  function generateVariant(seed, options) {
    const { size, flowerCountMin, flowerCountMax, petalLength, petalWidth, clusterRadius } = options;
    const rng = mulberry32(seed);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;

    const flowerCount = flowerCountMin + Math.floor(rng() * (flowerCountMax - flowerCountMin + 1));
    const centers = [];
    for (let i = 0; i < flowerCount; i++) {
      const angle = (i / flowerCount) * Math.PI * 2 + rng() * 0.8;
      const dist = rng() * clusterRadius * 0.75;
      centers.push({ x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist });
    }

    for (const c of centers) drawTranslucency(ctx, c.x, c.y, petalLength * 0.9);
    for (const c of centers) drawFlower(ctx, c.x, c.y, petalLength, petalWidth, rng);

    return canvas;
  }

  function generateVariantSet(count, baseSeed, options) {
    const set = [];
    for (let i = 0; i < count; i++) set.push(generateVariant(baseSeed + i * 733, options));
    return set;
  }

  root.SakuraFoliageTexture = { generateVariant, generateVariantSet };
})(typeof window !== "undefined" ? window : this);
