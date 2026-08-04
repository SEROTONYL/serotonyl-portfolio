(() => {
  "use strict";

  const {
    growSkeleton,
    computeThickness,
    buildCurves,
    buildSegmentPolygon,
    computeFoliagePlacements,
    defaultConfig,
    defaultFoliagePlacementConfig,
  } = window.SakuraBranchGeometry;

  // Настройки — тюнить тут (см. Task 6, визуальная сверка/подбор
  // параметров). zoneWidthFraction/rootFraction/tipFraction — доли
  // правой зоны экрана, а не всего вьюпорта (design spec "Композиция").
  // Параметры генерации/геометрии (spineSegments...segmentSamples,
  // stepLength...placementSeedBase) идут из branch-geometry.js's
  // defaultConfig/defaultFoliagePlacementConfig — единый источник истины,
  // общий с tests/branch-sweep.test.js и tests/foliage-placement-sweep.test.js,
  // чтобы тюнинг тут не мог молча разойтись с тем, что проверяют
  // sweep-тесты.
  const CONFIG = Object.assign({}, defaultConfig, defaultFoliagePlacementConfig, {
    seed: 20260802,
    curveSeed: 20260803,
    zoneWidthFraction: 0.48,
    rootFraction: { x: 1.08, y: 1.08 },
    tipFraction: { x: 0.08, y: 0.1 },
    color: "rgb(48, 64, 88)",
    fillOpacity: 0.55,
  });

  const svg = document.querySelector(".opening__branch");
  let foliagePlacements = [];

  // Зона в реальных пикселях считается от svg.clientWidth/Height (не
  // window.innerWidth/innerHeight) — тот же приём, что и в wires.js
  // (canvas.clientWidth), устойчивее к скроллбарам/dvh-округлению.
  function computeRootTip() {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    const zoneWidth = width * CONFIG.zoneWidthFraction;
    const zoneLeft = width - zoneWidth;
    return {
      root: {
        x: zoneLeft + zoneWidth * CONFIG.rootFraction.x,
        y: height * CONFIG.rootFraction.y,
      },
      tip: {
        x: zoneLeft + zoneWidth * CONFIG.tipFraction.x,
        y: height * CONFIG.tipFraction.y,
      },
    };
  }

  function svgEl(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function render() {
    const { root, tip } = computeRootTip();

    let nodes = growSkeleton({
      seed: CONFIG.seed,
      root,
      tip,
      spineSegments: CONFIG.spineSegments,
      wobbleFraction: CONFIG.wobbleFraction,
      stubChance: CONFIG.stubChance,
      stubAngleRangeDeg: CONFIG.stubAngleRangeDeg,
      stubSegmentsRange: CONFIG.stubSegmentsRange,
      stubLengthMultiplier: CONFIG.stubLengthMultiplier,
      angleJitterDeg: CONFIG.angleJitterDeg,
    });
    nodes = computeThickness(nodes, {
      tipThickness: CONFIG.tipThickness,
      murrayExponent: CONFIG.murrayExponent,
      chainGrowth: CONFIG.chainGrowth,
    });
    const curves = buildCurves(nodes, { seed: CONFIG.curveSeed, curveBendFraction: CONFIG.curveBendFraction });
    const byId = new Map(nodes.map((n) => [n.id, n]));

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Все сегменты и стыковые круги — в одну группу, ОБЩАЯ полупрозрачность
    // через `opacity` на группе, а не `fill-opacity` на каждом элементе.
    // Это не взаимозаменяемо: fill-opacity — наследуемый CSS-параметр
    // отрисовки заливки, если поставить его на группе, а не на детях, он
    // просто каскадом досталя каждому ребёнку то же самое значение — эффект
    // идентичен тому, как если бы им поставили fill-opacity по отдельности
    // (первая попытка этого фикса наступила ровно на эту грабли). `opacity`
    // — другое свойство: оно НЕ наследуется и создаёт настоящий композит-
    // слой — дети сначала рисуются друг на друге полностью непрозрачными
    // (перекрытия сливаются в сплошную заливку, без накопления альфы), и
    // только готовый результат целиком уходит в фон с одной степенью
    // прозрачности. Раньше круг поверх конца полигона (так и задумано —
    // круг рисуется в каждом узле, чтобы закрыть шов) и два сегмента,
    // расходящиеся в развилке, каждый со своей fill-opacity 0.55,
    // складывали альфу (1-(1-0.55)² ≈ 0.80) — отсюда были тёмные "кружки"
    // на каждом стыке и мутное пятно на развилках.
    const group = svgEl("g");
    group.setAttribute("fill", CONFIG.color);
    group.setAttribute("opacity", CONFIG.fillOpacity);
    svg.appendChild(group);

    // На развилке buildSegmentPolygon для КАЖДОГО ребёнка тянет ленту от
    // parent.thickness (толщина, которой хватает на всех детей вместе,
    // закон Мюррея) до собственной node.thickness. Если оба ребёнка узла
    // рисовать так, боковой пенёк у самой точки развилки становится таким
    // же толстым, как ствол, и лишь потом сужается — визуально это и
    // читалось как "веточка внутри ствола". Настоящее продолжение хребта
    // (самый толстый ребёнок узла) по-прежнему тянется от полной толщины
    // родителя — это одна и та же "жила". Любой другой (боковой) ребёнок —
    // это ответвление, а не продолжение того же ствола, поэтому его лента
    // должна сужаться сразу от развилки: старт — не parent.thickness, а
    // node.thickness с небольшой прибавкой (SECONDARY_TAPER_BLEND — доля
    // разницы до parent.thickness) чисто для плавного "воротничка" в месте
    // отрыва, а не полное наследование толщины хребта.
    const SECONDARY_TAPER_BLEND = 0.25;
    const childrenByParent = new Map();
    for (const node of nodes) {
      if (node.parentId === null) continue;
      if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
      childrenByParent.get(node.parentId).push(node);
    }
    const dominantChildId = new Map();
    for (const [parentId, children] of childrenByParent) {
      let best = children[0];
      for (const child of children) {
        if (child.thickness > best.thickness) best = child;
      }
      dominantChildId.set(parentId, best.id);
    }

    for (const node of nodes) {
      if (node.parentId === null) continue;
      const parent = byId.get(node.parentId);
      const control = curves.get(node.id);
      const isDominant = dominantChildId.get(node.parentId) === node.id;
      const segmentParent = isDominant
        ? parent
        : Object.assign({}, parent, {
            thickness: node.thickness + (parent.thickness - node.thickness) * SECONDARY_TAPER_BLEND,
          });
      const polygon = buildSegmentPolygon(segmentParent, node, control, CONFIG.segmentSamples);
      const points = polygon.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const el = svgEl("polygon");
      el.setAttribute("points", points);
      group.appendChild(el);
    }

    // Скругление стыков: круг радиусом в собственную толщину узла поверх
    // каждого сегмента — гарантированно закрывает зазор/шов на изломе, не
    // требует точной геометрической стыковки полигонов сегментов.
    for (const node of nodes) {
      const circle = svgEl("circle");
      circle.setAttribute("cx", node.x.toFixed(1));
      circle.setAttribute("cy", node.y.toFixed(1));
      circle.setAttribute("r", (node.thickness / 2).toFixed(1));
      group.appendChild(circle);
    }

    foliagePlacements = computeFoliagePlacements(nodes, curves, CONFIG);

    // Листва v3 рендерится отдельным 3D-слоем (foliage-3d.js, three.js).
    // Событие — единственный канал синхронизации: и начальный рендер, и
    // каждый resize идут через один и тот же render(), так что 3D-слой
    // никогда не может увидеть только часть обновления (иначе трёхмерная
    // листва рассинхронится со 2D-веткой под ней на resize).
    window.dispatchEvent(
      new CustomEvent("sakura-branch:render", {
        detail: { placements: foliagePlacements.slice(), width: svg.clientWidth, height: svg.clientHeight },
      })
    );
  }

  window.SakuraBranch = {
    // Копия, а не живой массив: render() пересоздаёт foliagePlacements на
    // каждый resize, и потребитель, держащий ссылку на старый вызов, не
    // должен видеть неожиданную подмену/мутацию.
    getFoliagePlacements: () => foliagePlacements.slice(),
  };

  window.addEventListener("resize", render);
  render();
})();
