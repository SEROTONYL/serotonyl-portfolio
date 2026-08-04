import * as THREE from "./vendor/three.module.min.js";

(function () {
  "use strict";

  const canvas = document.querySelector(".opening__foliage");
  const svg = document.querySelector(".opening__branch");
  if (!canvas || !svg || !window.SakuraBranch || !window.SakuraBranchGeometry || !window.SakuraFoliageTexture) return;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();

  // Камера ортографическая (не perspective) и фиксированная (без орбиты) —
  // design spec "Адаптивность/камера". left=0/top=0, right=width/
  // bottom=height намеренно (НЕ top=height/bottom=0): при top<bottom
  // world-Y=0 проецируется в верх экрана, world-Y=height — в низ, что
  // совпадает с системой координат SVG-скелета без ручного переворота Y.
  const CAMERA_Z = 1200;
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 1, CAMERA_Z + 2000);
  camera.position.set(0, 0, CAMERA_Z);

  // Интенсивности подобраны на глаз в Task 8 (визуальная проверка), но
  // порядок величины не произвольный: начиная с three.js r155 свет физичен
  // по умолчанию (useLegacyLights=false), а Lambert-BRDF делит облучённость
  // на π. Со стартовыми значениями (ambient 0.65 тёмного 0x303844 + key 0.9)
  // суммарная облучённость была ~0.78, т.е. ~0.25x albedo после /π —
  // текстура с её светлыми кончиками лепестков (luma ~210) выходила на
  // экран максимум luma ~102, и весь нарисованный градиент "тёмная база →
  // светлый кончик" схлопывался в почти чёрную кляксу. Правило: сумма
  // (ambientColor*ambientI + keyColor*keyI) должна быть порядка π, чтобы
  // освещённая сторона воспроизводила albedo примерно 1:1.
  // Баланс ambient/key важнее их суммы. При ambient 1.8 / key 2.4 суммарная
  // яркость была нормальной, но ambient давал ~78% светимости — а ambient
  // по определению не зависит от нормали, поэтому весь трюк с rounded
  // normals оказывался нечем модулировать: A/B-прогон (mix 0.85 против
  // mix 0.0) давал среднюю яркость 114.0 против 116.4 при std 28.9 против
  // 29.1, т.е. эффект был численно и визуально неразличим. Сдвигаем баланс
  // в сторону направленного света: ambient только подсвечивает теневую
  // сторону, объём лепит key.
  const ambient = new THREE.AmbientLight(0xb8c4d4, 0.9);
  scene.add(ambient);

  // Направление ключевого света совпадает с источником света в CSS-
  // градиенте фона (CLAUDE.md: radial-gradient центр ~18% 8% вьюпорта) —
  // не произвольный угол, а тот же "холодный свет сверху-слева", что и
  // весь остальной opening-экран.
  // Цвет ключевого света держим почти нейтральным (не насыщенно-голубым):
  // albedo текстуры уже синевато-серый, а умножение синего на синий уводило
  // бы кластер по тону от ствола (design spec: строгая монохромность,
  // никакого дрейфа оттенка).
  const key = new THREE.DirectionalLight(0xf0f4fa, 3.2);
  scene.add(key);
  scene.add(key.target);

  const PLACEMENT_CONFIG = window.SakuraBranchGeometry.defaultFoliagePlacementConfig;
  const TEXTURE_CONFIG = {
    size: 256,
    flowerCountMin: 3,
    flowerCountMax: 5,
    petalLength: 64,
    petalWidth: 52,
    // Габарит проверен вручную: макс. вынос от центра карточки =
    // clusterRadius*0.75 + petalLength = 49.5 + 64 = 113.5 < 128 (size/2),
    // т.е. лепестки не срезаются краем текстуры.
    clusterRadius: 66,
  };

  const variantCanvases = window.SakuraFoliageTexture.generateVariantSet(
    PLACEMENT_CONFIG.variantCount,
    PLACEMENT_CONFIG.placementSeedBase + 999,
    TEXTURE_CONFIG
  );

  // "Rounded normals" (ez-tree technique, design spec "Архитектура
  // рендера"): смешиваем нормаль плоской карточки с направлением от её
  // центра к вершине, домышленным в псевдо-3D через фиксированный Z
  // (ROUNDED_RADIUS) — геометрия остаётся плоским квадом, но свет ведёт
  // себя как на выпуклой поверхности. Чисто визуальный трюк, ноль
  // дополнительных треугольников.
  //
  // Единицы измерения: ROUNDED_RADIUS живёт в том же object-space, что и
  // `position` карточки в шейдере — а карточка это `PlaneGeometry(1, 1)`,
  // т.е. position.xy лежит примерно в [-0.5, 0.5], НЕ в пикселях текстуры
  // (256px). Значение должно быть того же порядка, что и половина стороны
  // квада (~0.5), иначе normalize(vec3(position.xy, R)) с R на порядки
  // больше даёт почти плоскую нормаль — эффект скругления станет
  // визуально неразличим (было найдено в ревью: R=55 давал < 0.5°
  // отклонения). Ориентир: atan(0.5 / R) ~ угол наклона нормали на краю
  // карточки — R=0.5 даёт ~45°, R=0.7 ~35°, R=1.0 ~26°.
  //
  // ИТОГ ВИЗУАЛЬНОЙ ПРОВЕРКИ (Task 8), важно не переоценивать этот трюк:
  // на реальном масштабе карточки (~37-67px) он даёт ИЗМЕРИМЫЙ, но
  // визуально НЕРАЗЛИЧИМЫЙ вклад. Контрольный A/B (mix 0.85 против mix 0.0,
  // всё остальное идентично) дал среднюю яркость 114.0 против 116.4 при
  // std 28.9 против 29.1 — и два кроп-скриншота одного и того же участка
  // кроны отличить на глаз нельзя. Проверено, что инъекция шейдера жива:
  // подстановка заведомо экстремальной нормали vec3(1,0,0.05) роняет
  // среднюю яркость до 90.5, т.е. свет на нормаль реагирует. Причина
  // слабости эффекта в том, что весь key-light даёт лишь ~22% итоговой
  // светимости кластера, а объём на экране лепит СОБСТВЕННЫЙ градиент
  // текстуры (тёмная база → светлый кончик лепестка), а не сцена.
  // Балансировку света в пользу key (ambient 1.8→0.9, key 2.4→3.2) сделали
  // — диапазон расширился (35-198 против 34-194) , но на глаз это всё
  // равно не читается. Радиус оставлен 0.5: трогать его дальше смысла нет,
  // это не тот рычаг, который управляет видимым объёмом.
  const ROUNDED_RADIUS = 0.5;

  function makeMaterial(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      // depthWrite:false намеренно. С transparent:true + depthWrite:true
      // карточка, нарисованная раньше, записывала глубину вместе со своей
      // полупрозрачной каймой и обрезала ею соседей — на перекрытиях
      // появлялись жёсткие края и обрубленные куски (найдено в Task 8).
      // Порядок отрисовки у нас всё равно попер-меш, а не попер-инстанс,
      // так что честной сортировки прозрачных карточек тут не будет в
      // принципе; отключаем запись глубины и даём им мягко смешиваться.
      // Цена: p.z (depthJitter) больше не даёт реального перекрытия, он
      // остаётся только источником вариации — для одинаковых билбордов
      // одного силуэта это визуально неразличимо, а мягкое накопление
      // плотности на перекрытиях даже помогает читаемости кроны.
      depthWrite: false,
      alphaTest: 0.05,
      roughness: 0.85,
      metalness: 0,
      side: THREE.FrontSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRoundedRadius = { value: ROUNDED_RADIUS };
      const withUniform = `uniform float uRoundedRadius;\n${shader.vertexShader}`;
      const chunkMarker = "#include <beginnormal_vertex>";
      // Guard: if a future three.js version relocates/renames this chunk,
      // String.replace() below would silently no-op and the rounded-
      // normals effect would just stop existing with zero errors anywhere
      // — surface that as a console warning instead of a silent miss.
      if (withUniform.indexOf(chunkMarker) === -1) {
        console.warn(
          "[foliage-3d] onBeforeCompile: vertex shader chunk '#include <beginnormal_vertex>' not found — rounded-normals shading is disabled for this material."
        );
      }
      shader.vertexShader = withUniform.replace(
        chunkMarker,
        `#include <beginnormal_vertex>
  vec3 roundedNormal = normalize(vec3(position.xy, uRoundedRadius));
  objectNormal = normalize(mix(objectNormal, roundedNormal, 0.85));`
      );
    };
    return material;
  }

  const materials = variantCanvases.map(makeMaterial);
  const cardGeometry = new THREE.PlaneGeometry(1, 1);

  const MAX_INSTANCES_PER_VARIANT = 600;
  const instancedMeshes = materials.map((material) => {
    const mesh = new THREE.InstancedMesh(cardGeometry, material, MAX_INSTANCES_PER_VARIANT);
    mesh.count = 0;
    // Инстансы разбросаны далеко за пределы bounding sphere карточки
    // 1x1 — без этого three.js может отсечь весь mesh как "за кадром" по
    // ошибочному авто-culling от геометрии, а не реальных инстансов.
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });

  const dummy = new THREE.Object3D();

  function rebuild(placements, width, height) {
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();

    key.position.set(width * 0.18, height * 0.08, CAMERA_Z * 0.6);
    key.target.position.set(width * 0.5, height * 0.5, 0);
    key.target.updateMatrixWorld();

    renderer.setSize(width, height, false);

    const perVariantCount = new Array(instancedMeshes.length).fill(0);
    for (const p of placements) {
      const mesh = instancedMeshes[p.variantIndex];
      const i = perVariantCount[p.variantIndex];
      if (i >= MAX_INSTANCES_PER_VARIANT) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, p.rotationZ);
      // Y-scale is negated on purpose: the orthographic camera above uses
      // camera.top = 0 / camera.bottom = height (see the comment near its
      // construction) so world-Y matches SVG pixel-Y directly. That flips
      // the projected Y axis relative to three.js's usual convention,
      // which mirrors the post-projection winding order of every quad —
      // three.js decides front/back-facing from that winding, not from
      // world-space geometry, so with the material's default
      // `side: THREE.FrontSide` every card would be classified as
      // back-facing and culled, rendering nothing. Negating the instance's
      // Y scale here re-mirrors each quad's own vertices, cancelling the
      // camera's mirror back out for winding purposes — and because
      // three.js derives per-instance normals from mat3(instanceMatrix),
      // the same negation correctly flips the normal back too, so the
      // rounded-normals lighting still points the right way instead of
      // being inverted away from the key light.
      dummy.scale.set(p.scale, -p.scale, p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      perVariantCount[p.variantIndex] = i + 1;
    }
    instancedMeshes.forEach((mesh, vi) => {
      mesh.count = perVariantCount[vi];
      mesh.instanceMatrix.needsUpdate = true;
    });

    renderer.render(scene, camera);
  }

  // Начальный рендер — напрямую (не ждём событие): к моменту, когда этот
  // модуль выполнится, branch.js (обычный defer-скрипт, идёт раньше в
  // index.html) уже вызвал свой render() минимум один раз, так что
  // getFoliagePlacements() уже отдаёт актуальные данные.
  rebuild(window.SakuraBranch.getFoliagePlacements(), svg.clientWidth, svg.clientHeight);

  // Дальнейшие обновления (resize) — только через событие: branch.js уже
  // решает, когда геометрия скелета пересчитана, дублировать его
  // resize-listener здесь не нужно и рискует рассинхроном (два разных
  // resize-хендлера, гоняющихся за одним и тем же svg.clientWidth).
  window.addEventListener("sakura-branch:render", (event) => {
    rebuild(event.detail.placements, event.detail.width, event.detail.height);
  });
})();
