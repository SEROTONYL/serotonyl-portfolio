(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.SakuraBranchGeometry = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Детерминированный PRNG — тот же алгоритм, что уже используется в wires.js.
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

  // Главный хребет — прямая линия root->tip с перпендикулярным "вилянием"
  // на промежуточных узлах (не угловой джиттер: угловой джиттер рискует
  // накопить ошибку и промахнуться мимо tip, перпендикулярное смещение от
  // базовой линии гарантирует точное попадание в tip последним узлом).
  function buildSpine(root, tip, spineSegments, wobbleFraction, rng) {
    const dx = tip.x - root.x;
    const dy = tip.y - root.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    const nodes = [{ id: 0, parentId: null, x: root.x, y: root.y, depth: 0 }];
    for (let i = 1; i <= spineSegments; i++) {
      let x, y;
      if (i === spineSegments) {
        // Ensure exact tip positioning (bit-exact, not derived through float lerp)
        x = tip.x;
        y = tip.y;
      } else {
        const t = i / spineSegments;
        x = root.x + dx * t;
        y = root.y + dy * t;
        const wobble = (rng() * 2 - 1) * len * wobbleFraction;
        x += nx * wobble;
        y += ny * wobble;
      }
      nodes.push({ id: i, parentId: i - 1, x, y, depth: i });
    }
    return nodes;
  }

  // Верхняя граница на то, как далеко пенёк может "дотянуться" от точки
  // крепления: суммарная длина всех сегментов одного пенька не должна
  // превышать эту долю от spineLen (полная root->tip дистанция). Без этой
  // границы stubLengthMultiplier, зависящий только от длины ОДНОГО
  // сегмента хребта (spineSegLen), может на узких/высоких вьюпортах увести
  // узлы далеко за пределы зоны ветки — см. tests/branch-sweep.test.js.
  const MAX_STUB_REACH_FRACTION = 0.22;

  // Насколько сильнее укорачиваются пеньки по мере углубления вдоль хребта
  // (растёт spine index i, т.е. дальше от корня). При i в самом конце
  // хребта (i близко к spineSegments) пенёк дотягивается максимум примерно
  // на (1 - DEPTH_TAPER_STRENGTH) от того, на сколько дотянулся бы
  // эквивалентный пенёк у корня (i=0), при прочих равных. Раньше длина
  // пенька не зависела от глубины вообще — это и давало эффект "метлы"
  // (4-е поколение веточек не короче ствола), из-за чего первую попытку
  // этой фичи отклонил заказчик.
  const DEPTH_TAPER_STRENGTH = 0.5;
  // Пол на depthFactor — не даём пенькам на самом кончике хребта схлопнуться
  // в вырожденную нулевую длину.
  const MIN_DEPTH_FACTOR = 0.4;

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  // Минимальный зазор, который пенёк должен держать от ЛЮБОГО сегмента
  // хребта (кроме как у самой точки крепления — там общий узел, там
  // ожидаемо тесно). Без этой проверки угол пенька считается только от
  // ВХОДЯЩЕГО направления хребта (см. mainAngle ниже) — если хребет сам
  // после точки крепления вильнёт в ту же сторону, что и пенёк, пенёк
  // может случайно пойти почти параллельно и вплотную следующему сегменту
  // хребта на всю свою длину — выглядит как двойная линия/шов вдоль
  // ствола, а не как ответвление.
  const MIN_STUB_CLEARANCE_FRACTION = 0.2;
  const STUB_NEAR_JOINT_FRACTION = 0.15;
  const STUB_ANGLE_RETRY_LIMIT = 8;

  // Возвращает наименьший зазор от точек пенька (кроме тех, что ближе
  // nearJointRadius к своему креплению) до любого сегмента хребта —
  // Infinity, если все точки исключены (пенёк короче nearJointRadius).
  function stubClearanceFromSpine(points, spineNodes, spineSegments, nearJointRadius) {
    let minDist = Infinity;
    for (const p of points) {
      if (p.distFromJoint < nearJointRadius) continue;
      for (let j = 0; j < spineSegments; j++) {
        const a = spineNodes[j];
        const b = spineNodes[j + 1];
        const d = pointToSegmentDistance(p.x, p.y, a.x, a.y, b.x, b.y);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  }

  // Боковые "пеньки": на каждом внутреннем узле хребта (не корень, не
  // кончик) — с вероятностью stubChance пускаем короткую цепочку сегментов
  // под углом к направлению хребта в этой точке.
  function attachStubs(nodes, options, rng) {
    const { spineSegments, stubChance, stubAngleRangeDeg, stubSegmentsRange, stubLengthMultiplier, angleJitterDeg } = options;
    const spineLen = Math.hypot(nodes[spineSegments].x - nodes[0].x, nodes[spineSegments].y - nodes[0].y);
    const spineSegLen = spineLen / spineSegments;
    const maxStubReach = spineLen * MAX_STUB_REACH_FRACTION;
    const minClearance = spineSegLen * MIN_STUB_CLEARANCE_FRACTION;
    const nearJointRadius = spineSegLen * STUB_NEAR_JOINT_FRACTION;

    for (let i = 1; i < spineSegments; i++) {
      if (rng() >= stubChance) continue;

      const parent = nodes[i];
      const prev = nodes[i - 1];
      const mainAngle = Math.atan2(parent.y - prev.y, parent.x - prev.x);

      const stubSegCount = stubSegmentsRange[0] + Math.floor(rng() * (stubSegmentsRange[1] - stubSegmentsRange[0] + 1));
      const lenMultiplier = stubLengthMultiplier[0] + rng() * (stubLengthMultiplier[1] - stubLengthMultiplier[0]);
      const depthFactor = Math.max(1 - (i / spineSegments) * DEPTH_TAPER_STRENGTH, MIN_DEPTH_FACTOR);
      const totalStubLen = Math.min(spineSegLen * lenMultiplier * depthFactor, maxStubReach);

      // Later segments within the stub's own chain get progressively
      // shorter (weight segment index s, 0-based, by (stubSegCount - s)),
      // normalized so the weighted lengths still sum to totalStubLen — total
      // stub reach is unaffected, only the internal distribution changes.
      let weightSum = 0;
      for (let k = 0; k < stubSegCount; k++) weightSum += stubSegCount - k;

      // Пробуем несколько углов (side/offsetDeg заново, плюс свежий jitter
      // на каждой попытке), пока цепочка не пройдёт с достаточным зазором
      // от хребта. Если ни одна попытка не прошла порог — берём ЛУЧШУЮ из
      // проверенных (по факту зазора), а не последнюю подряд: последняя
      // попытка не обязательно лучшая, и слепой fallback на неё однажды
      // пропустил случай почти полного слияния пенька со хребтом (найдено
      // сканом 2000 сидов: 0.3px зазора при 4 попытках — с ростом лимита
      // попыток до 8 и выбором лучшей из них худший случай на том же
      // скане сжался до ~22px).
      let chosenPoints = null;
      let bestPoints = null;
      let bestClearance = -Infinity;
      for (let attempt = 0; attempt < STUB_ANGLE_RETRY_LIMIT; attempt++) {
        const side = rng() < 0.5 ? -1 : 1;
        const offsetDeg = stubAngleRangeDeg[0] + rng() * (stubAngleRangeDeg[1] - stubAngleRangeDeg[0]);
        let angle = mainAngle + side * ((offsetDeg * Math.PI) / 180);

        const points = [];
        let x = parent.x;
        let y = parent.y;
        let distFromJoint = 0;
        for (let s = 0; s < stubSegCount; s++) {
          if (s > 0) angle += (rng() * 2 - 1) * ((angleJitterDeg * Math.PI) / 180);
          const segLen = totalStubLen * ((stubSegCount - s) / weightSum);
          x += Math.cos(angle) * segLen;
          y += Math.sin(angle) * segLen;
          distFromJoint += segLen;
          points.push({ x, y, distFromJoint });
        }

        const clearance = stubClearanceFromSpine(points, nodes, spineSegments, nearJointRadius);
        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestPoints = points;
        }
        if (clearance >= minClearance) {
          chosenPoints = points;
          break;
        }
      }
      if (!chosenPoints) chosenPoints = bestPoints;

      let parentId = parent.id;
      for (let s = 0; s < chosenPoints.length; s++) {
        const p = chosenPoints[s];
        const node = { id: nodes.length, parentId, x: p.x, y: p.y, depth: parent.depth + s + 1 };
        nodes.push(node);
        parentId = node.id;
      }
    }
  }

  function growSkeleton(options) {
    const rng = mulberry32(options.seed);
    const nodes = buildSpine(options.root, options.tip, options.spineSegments, options.wobbleFraction, rng);
    attachStubs(nodes, options, rng);
    return nodes;
  }

  // Толщина от кончиков к корню (закон Мюррея): толщина узла считается из
  // суммы толщин детей в степени murrayExponent, плюс небольшой
  // "chainGrowth" — фиксированный вклад на каждый хоп, из-за которого
  // толщина плавно растёт и вдоль НЕветвящегося участка, а не только на
  // развилках (без этого добавления один-единственный ребёнок давал бы
  // родителю точно ту же толщину — не сужение, а просто перенос).
  function computeThickness(nodes, options) {
    const { tipThickness, murrayExponent, chainGrowth } = options;
    const childrenOf = new Map();
    for (const node of nodes) {
      if (node.parentId === null) continue;
      if (!childrenOf.has(node.parentId)) childrenOf.set(node.parentId, []);
      childrenOf.get(node.parentId).push(node.id);
    }

    const thickness = new Map();
    function resolve(id) {
      if (thickness.has(id)) return thickness.get(id);
      const children = childrenOf.get(id) || [];
      let value;
      if (children.length === 0) {
        value = tipThickness;
      } else {
        const sumPow = children.reduce((acc, childId) => acc + Math.pow(resolve(childId), murrayExponent), 0);
        const growthPow = Math.pow(tipThickness, murrayExponent) * chainGrowth;
        value = Math.pow(sumPow + growthPow, 1 / murrayExponent);
      }
      thickness.set(id, value);
      return value;
    }

    for (const node of nodes) resolve(node.id);
    return nodes.map((node) => Object.assign({}, node, { thickness: thickness.get(node.id) }));
  }

  // Общая формула контрольной точки квадратичной кривой: середина хорды
  // + перпендикулярное смещение на bend. Используется и хребтом
  // (buildCurves), и веточками кластера листвы (growFoliageCluster) —
  // один и тот же приём на двух разных масштабах.
  function perpendicularControlPoint(x1, y1, x2, y2, bend) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return { x: (x1 + x2) / 2 + nx * bend, y: (y1 + y2) / 2 + ny * bend };
  }

  // Кривизна — независимо на КАЖДОМ отдельном сегменте (родитель->узел),
  // никогда не протягивается через несколько сегментов подряд. Контрольная
  // точка — середина хорды со случайным перпендикулярным смещением; знак и
  // сила смещения берутся из отдельного seeded rng, проходящего по узлам
  // в порядке id, поэтому результат детерминирован и не зависит от того,
  // сколько случайных чисел уже потребил rng роста скелета.
  function buildCurves(nodes, options) {
    const rng = mulberry32(options.seed);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const curves = new Map();
    for (const node of nodes) {
      if (node.parentId === null) continue;
      const parent = byId.get(node.parentId);
      const len = Math.hypot(node.x - parent.x, node.y - parent.y) || 1;
      const bend = (rng() * 2 - 1) * len * options.curveBendFraction;
      curves.set(node.id, perpendicularControlPoint(parent.x, parent.y, node.x, node.y, bend));
    }
    return curves;
  }

  function quadPoint(p0, c, p1, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
    };
  }

  function quadTangent(p0, c, p1, t) {
    const mt = 1 - t;
    return {
      x: 2 * mt * (c.x - p0.x) + 2 * t * (p1.x - c.x),
      y: 2 * mt * (c.y - p0.y) + 2 * t * (p1.y - c.y),
    };
  }

  // Заполненная "лента": на каждом сэмпле вдоль кривой откладываем
  // толщину, линейно интерполированную между parent.thickness и
  // node.thickness, перпендикулярно касательной в этой точке.
  function buildSegmentPolygon(parent, node, control, samples) {
    const left = [];
    const right = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = quadPoint(parent, control, node, t);
      const tangent = quadTangent(parent, control, node, t);
      const tangentLen = Math.hypot(tangent.x, tangent.y) || 1;
      const nx = -tangent.y / tangentLen;
      const ny = tangent.x / tangentLen;
      const halfThickness = ((1 - t) * parent.thickness + t * node.thickness) / 2;
      left.push({ x: point.x + nx * halfThickness, y: point.y + ny * halfThickness });
      right.push({ x: point.x - nx * halfThickness, y: point.y - ny * halfThickness });
    }
    return left.concat(right.slice().reverse());
  }

  // Плотность (density-weight) убывает с глубиной от корня — тот же
  // принцип, что был в v1 (ANCHOR_WEIGHT_TAPER), теперь применяется на
  // уровне РЁБЕР (parent->node), не узлов: вес ребра = среднее весов
  // его концов. windWeight — намеренно ОБРАТНАЯ величина (1 - weight):
  // это разные переменные на одной оси "позиция вдоль ветки" (density
  // растёт к корню, wind растёт к периферии) — не путать одну с другой,
  // см. design spec "Данные под будущий ветер".
  const FOLIAGE_WEIGHT_TAPER = 0.7;
  const FOLIAGE_PLACEMENT_SEED_MULTIPLIER = 131;

  function edgeDensityWeight(parent, node, maxDepth) {
    const avgDepth = (parent.depth + node.depth) / 2;
    return 1 - (avgDepth / maxDepth) * FOLIAGE_WEIGHT_TAPER;
  }

  // Размещение карточек — стратифицированная выборка по длине КАЖДОГО
  // ребра скелета (не только зафиксированных узлов, design spec
  // "Размещение"), по методу ez-tree: ребро делится на N интервалов по
  // длине дуги, одна карточка на интервал со случайным сдвигом внутри
  // (stratified, не uniform-random — устраняет и решётчатость, и разрывы/
  // слипание). Длина дуги считается той же квадратичной кривой, что уже
  // рисует сам ствол (quadPoint), сэмплированием, а не аналитической
  // формулой — держит эту функцию согласованной с тем, что реально
  // нарисовано на экране.
  function computeFoliagePlacements(nodes, curves, options) {
    const {
      stepLength,
      radialJitter,
      depthJitterMin,
      depthJitterMax,
      scaleBase,
      scaleJitter,
      scaleWeightBoost,
      variantCount,
      placementSeedBase,
    } = options;

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const maxDepth = Math.max(...nodes.map((n) => n.depth)) || 1;
    const placements = [];

    for (const node of nodes) {
      if (node.parentId === null) continue;
      const parent = byId.get(node.parentId);
      const control = curves.get(node.id);
      const weight = edgeDensityWeight(parent, node, maxDepth);

      const arcSamples = 12;
      let arcLen = 0;
      let prev = quadPoint(parent, control, node, 0);
      for (let s = 1; s <= arcSamples; s++) {
        const p = quadPoint(parent, control, node, s / arcSamples);
        arcLen += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }

      const count = Math.max(1, Math.round(arcLen / stepLength));
      const rng = mulberry32(placementSeedBase + node.id * FOLIAGE_PLACEMENT_SEED_MULTIPLIER);

      for (let i = 0; i < count; i++) {
        const t = (i + rng()) / count;
        const point = quadPoint(parent, control, node, t);
        const tangent = quadTangent(parent, control, node, t);
        const tangentLen = Math.hypot(tangent.x, tangent.y) || 1;
        const nx = -tangent.y / tangentLen;
        const ny = tangent.x / tangentLen;

        const radial = (rng() * 2 - 1) * radialJitter * (0.4 + weight * 0.6);
        const z = depthJitterMin + rng() * (depthJitterMax - depthJitterMin);
        const scale = Math.max(scaleBase + weight * scaleWeightBoost + (rng() * 2 - 1) * scaleJitter, 0.05);
        const rotationZ = rng() * Math.PI * 2;
        const variantIndex = Math.floor(rng() * variantCount);

        placements.push({
          x: point.x + nx * radial,
          y: point.y + ny * radial,
          z,
          rotationZ,
          scale,
          densityWeight: weight,
          windWeight: 1 - weight,
          variantIndex,
        });
      }
    }
    return placements;
  }

  // Общие тюнинговые параметры генерации/геометрии — единый источник
  // истины, чтобы branch.js (рендер) и tests/branch-sweep.test.js
  // (нагрузочный тест по вьюпортам) никогда не могли разойтись молча.
  // Экранно-специфичные вещи (seed/curveSeed/zoneWidthFraction/
  // rootFraction/tipFraction/color) сюда намеренно НЕ входят — это забота
  // branch.js, а не геометрии.
  const defaultConfig = {
    spineSegments: 8,
    wobbleFraction: 0.05,
    stubChance: 0.45,
    stubAngleRangeDeg: [35, 70],
    stubSegmentsRange: [2, 3],
    stubLengthMultiplier: [1.0, 1.8],
    angleJitterDeg: 8,
    tipThickness: 3,
    murrayExponent: 2.4,
    chainGrowth: 1.3,
    curveBendFraction: 0.22,
    segmentSamples: 8,
  };

  // Тюнинговые параметры размещения — единый источник истины для
  // branch.js и tests/foliage-placement-sweep.test.js, тот же принцип,
  // что и defaultConfig/defaultFoliagePlacementConfig раньше. Стартовые
  // значения — отправная точка для визуального тюнинга при интеграции
  // (Task 6/7 этого плана), не финальные магические числа.
  const defaultFoliagePlacementConfig = {
    // Значения подобраны на глаз в Task 8 (визуальная проверка), стартовые
    // были stepLength 22 / radialJitter 16 / scaleBase 26 / scaleWeightBoost
    // 18 — на реальном экране это давало "бусины на нитке": карточки по
    // 27-48px в одну линию вдоль спайна с просветами между ними, т.е. ровно
    // ту же претензию, из-за которой заказчик завернул v1 ("отдельные
    // точки, а не крона"). Шаг уменьшен (плотнее вдоль ветки), radialJitter
    // поднят (крона получает ширину поперёк спайна, а не остаётся 1D-цепочкой),
    // масштаб поднят так, чтобы отдельный цветок в кластере был ~20px и его
    // форма лепестка вообще читалась.
    stepLength: 14,
    radialJitter: 20,
    depthJitterMin: -40,
    depthJitterMax: 40,
    scaleBase: 34,
    scaleJitter: 8,
    scaleWeightBoost: 26,
    variantCount: 5,
    placementSeedBase: 20260804,
  };

  return {
    mulberry32,
    growSkeleton,
    attachStubs,
    computeThickness,
    buildCurves,
    buildSegmentPolygon,
    computeFoliagePlacements,
    defaultConfig,
    defaultFoliagePlacementConfig,
  };
});
