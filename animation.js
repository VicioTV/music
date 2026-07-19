(() => {
  "use strict";

  const LOOP_SECONDS = 8;
  const EXPLOSION_SECONDS = 16;
  const PREVIEW_SECONDS = 100;
  const IMAGE_WIDTH = 1664;
  const IMAGE_HEIGHT = 935;
  const scene = document.querySelector(".scene");
  const worldCanvas = document.querySelector("#world");
  const particleCanvas = document.querySelector("#particles");
  const particleContext = particleCanvas.getContext("2d");
  const trackButton = document.querySelector("#trackButton");
  const previewPlayback = document.querySelector("#previewPlayback");
  const trackSeek = document.querySelector("#trackSeek");
  const trackCurrent = document.querySelector("#trackCurrent");
  const trackDuration = document.querySelector("#trackDuration");
  const soundtrack = document.querySelector("#soundtrack");
  const loadState = document.querySelector("#loadState");
  const trackTitle = document.querySelector(".track-card__title");
  const trackArtist = document.querySelector(".track-card__artist");
  const recordLibrary = document.querySelector("#recordLibrary");
  const recordChoices = [...document.querySelectorAll("[data-track-id]")];
  const collectionTrigger = document.querySelector("#collectionTrigger");

  const TRACKS = [
    {
      id: 1,
      title: "I have to go… forever",
      artist: "Creador100k",
      image: "Imagen1.png",
      audio: "Imagen1.mp3",
      previewStart: 0,
      previewEnd: 100,
      sceneLabel: "Escena del portal",
    },
    {
      id: 2,
      title: "Perfume and Wine 壊さないで",
      artist: "Creador100k",
      image: "Imagen2.png",
      audio: "Imagen2.mp3",
      previewStart: 60,
      previewEnd: 159,
      sceneLabel: "Escena de la azotea bajo la tormenta",
    },
  ];

  let startTime = performance.now();
  let animationFrame = 0;
  let glProgram;
  let texture;
  let uniforms;
  let particles = [];
  let flashGrains = [];
  let audioContext;
  let audioAnalyser;
  let audioFrequencyData;
  let audioEnergy = 0;
  let audioPeak = 0;
  let audioBass = 0;
  let audioBassFlash = 0;
  let isSeeking = false;
  let activeTrack = TRACKS[0];
  let sceneTwoRain = [];
  let sceneTwoRainDrops = [];
  let sceneTwoParkEnergy = [];
  let sceneTwoDebris = [];
  let sceneTwoBuildingLights = [];
  let hasEnteredScene = false;

  const vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_imageResolution;
    uniform float u_time;
    uniform float u_progress;
    uniform float u_explosionProgress;

    float ellipse(vec2 point, vec2 center, vec2 radius) {
      vec2 delta = (point - center) / radius;
      return length(delta);
    }

    float softMask(float value, float innerEdge, float outerEdge) {
      return 1.0 - smoothstep(innerEdge, outerEdge, value);
    }

    float timedPulse(float progress, float center, float width) {
      return 1.0 - smoothstep(0.0, width, abs(progress - center));
    }

    vec2 gravityObject(
      vec2 point,
      vec2 center,
      vec2 radius,
      vec2 portal,
      float spin,
      float depth,
      float gravity,
      float orbit
    ) {
      vec2 pull = normalize(portal - center) * gravity * (4.5 + depth * 11.0);
      vec2 movedCenter = center + pull;
      vec2 local = point - movedCenter;
      float mask = 1.0 - smoothstep(0.64, 1.0, length(local / radius));
      float angle = spin * orbit * (0.028 + depth * 0.055);
      float cosine = cos(-angle);
      float sine = sin(-angle);
      mat2 rotation = mat2(cosine, -sine, sine, cosine);
      float objectScale = 1.0 + gravity * depth * 0.04;
      vec2 sampledPoint = center + rotation * local / objectScale;
      return (sampledPoint - point) * mask;
    }

    float objectPresence(vec2 point, vec2 center, vec2 radius) {
      float distanceToObject = length((point - center) / radius);
      return (1.0 - smoothstep(0.7, 1.0, distanceToObject)) * smoothstep(0.15, 0.72, distanceToObject);
    }

    float softBeam(vec2 point, vec2 origin, vec2 direction, float width, float beamLength) {
      vec2 axis = normalize(direction);
      vec2 relative = point - origin;
      float along = dot(relative, axis);
      float across = abs(relative.x * axis.y - relative.y * axis.x);
      float forwardFade = smoothstep(-35.0, 70.0, along) * (1.0 - smoothstep(beamLength * 0.72, beamLength, along));
      float sideFade = 1.0 - smoothstep(width * 0.18, width, across);
      return forwardFade * sideFade;
    }

    void main() {
      vec2 coverScale = max(u_resolution / u_imageResolution, vec2(1.0));
      float scale = max(u_resolution.x / u_imageResolution.x, u_resolution.y / u_imageResolution.y);
      vec2 renderedSize = u_imageResolution * scale;
      vec2 offset = (u_resolution - renderedSize) * 0.5;
      vec2 screenPx = v_uv * u_resolution;
      vec2 imagePx = (screenPx - offset) / scale;
      vec2 imageTopPx = vec2(imagePx.x, u_imageResolution.y - imagePx.y);
      vec2 uv = imagePx / u_imageResolution;
      float loopAngle = u_progress * 6.28318530718;

      vec2 portalCenter = vec2(1003.0, 410.0);
      float portalDistance = ellipse(imageTopPx, portalCenter, vec2(174.0, 371.0));
      float ringMask = smoothstep(0.67, 0.91, portalDistance) * (1.0 - smoothstep(1.06, 1.31, portalDistance));
      float heatMask = smoothstep(0.72, 0.97, portalDistance) * (1.0 - smoothstep(1.06, 1.43, portalDistance));
      float impact = pow(timedPulse(u_explosionProgress, 0.52, 0.3), 2.0);
      float charge = smoothstep(0.08, 0.4, u_explosionProgress) * (1.0 - smoothstep(0.72, 0.88, u_explosionProgress));
      float shockTimeLinear = clamp((u_explosionProgress - 0.2) / 0.64, 0.0, 1.0);
      float shockTime = pow(shockTimeLinear, 1.55);
      float shockLife = smoothstep(0.18, 0.23, u_explosionProgress) * (1.0 - smoothstep(0.84, 0.9, u_explosionProgress));
      float gravity = 0.5 - 0.5 * cos(loopAngle);
      float orbit = sin(loopAngle);

      float slowWave = sin(imageTopPx.y * 0.095 + loopAngle) + sin(imageTopPx.y * 0.037 - loopAngle * 2.0);
      vec2 heatShift = vec2(slowWave * 0.72, sin(imageTopPx.x * 0.052 + loopAngle) * 0.28);
      uv += heatShift / u_imageResolution * heatMask;

      float reflectionMask = softMask(ellipse(imageTopPx, vec2(1005.0, 815.0), vec2(118.0, 137.0)), 0.08, 1.0);
      float reflectionFade = smoothstep(748.0, 785.0, imageTopPx.y);
      vec2 ripple = vec2(
        sin(imageTopPx.y * 0.19 + loopAngle * 2.0) * 1.15,
        sin(imageTopPx.x * 0.075 - loopAngle) * 0.18
      );
      uv += ripple / u_imageResolution * reflectionMask * reflectionFade * (1.0 + impact * 4.5);

      float humanHeadAnchor = softMask(ellipse(imageTopPx, vec2(710.0, 465.0), vec2(42.0, 39.0)), 0.08, 1.0);
      float humanTorsoAnchor = softMask(ellipse(imageTopPx, vec2(691.0, 590.0), vec2(68.0, 132.0)), 0.12, 1.0);
      float humanLegAnchor = softMask(ellipse(imageTopPx, vec2(684.0, 780.0), vec2(55.0, 184.0)), 0.1, 1.0);
      float humanAnchorMask = max(humanHeadAnchor, max(humanTorsoAnchor, humanLegAnchor));

      vec2 debrisShift = vec2(0.0);
      debrisShift += gravityObject(imageTopPx, vec2(390.0, 145.0), vec2(53.0, 48.0), portalCenter,  1.0, 0.62, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(488.0, 430.0), vec2(47.0, 58.0), portalCenter, -1.0, 0.82, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(246.0, 505.0), vec2(69.0, 59.0), portalCenter,  1.0, 0.9, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(491.0, 698.0), vec2(45.0, 40.0), portalCenter, -1.0, 0.66, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(91.0, 584.0), vec2(33.0, 34.0), portalCenter,  1.0, 0.74, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(719.0, 42.0), vec2(39.0, 43.0), portalCenter, -1.0, 0.58, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(1284.0, 350.0), vec2(67.0, 64.0), portalCenter, -1.0, 0.78, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(1456.0, 516.0), vec2(57.0, 46.0), portalCenter,  1.0, 0.96, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(1324.0, 571.0), vec2(50.0, 47.0), portalCenter, -1.0, 0.72, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(1540.0, 605.0), vec2(72.0, 58.0), portalCenter,  1.0, 1.0, gravity, orbit);
      debrisShift += gravityObject(imageTopPx, vec2(1515.0, 270.0), vec2(47.0, 55.0), portalCenter, -1.0, 0.7, gravity, orbit);
      uv += vec2(debrisShift.x, -debrisShift.y) / u_imageResolution;

      float skyMask = smoothstep(40.0, 145.0, imageTopPx.y) * (1.0 - smoothstep(555.0, 730.0, imageTopPx.y));
      float skyBreath = 0.22 + gravity * 0.78;
      vec2 cloudShift = vec2(
        sin(imageTopPx.y * 0.017 + loopAngle) * (0.75 + gravity * 1.45),
        cos(imageTopPx.x * 0.011 - loopAngle * 2.0) * (0.25 + gravity * 0.62)
      );
      uv += vec2(cloudShift.x, -cloudShift.y) / u_imageResolution * skyMask * (1.0 - humanAnchorMask);

      vec2 portalVector = (imageTopPx - portalCenter) / vec2(174.0, 371.0);
      vec2 portalDirection = normalize(portalVector + vec2(0.0001));
      float shockRadius = mix(1.0, 6.8, shockTime);
      float shockSharpness = mix(7.5, 2.65, shockTime);
      float shockRing = exp(-pow((portalDistance - shockRadius) * shockSharpness, 2.0)) * shockLife;
      vec2 shockShift = vec2(portalDirection.x, -portalDirection.y) * (impact * -5.5 + shockRing * 6.4);
      uv += shockShift / u_imageResolution * (1.0 - humanAnchorMask * 0.98);

      vec2 chromaDirection = vec2(portalDirection.x, -portalDirection.y) / u_imageResolution;
      float chromaMask = (impact * 2.8 + shockRing * 1.7)
        * softMask(portalDistance, 0.0, 7.2)
        * (1.0 - humanAnchorMask * 0.96);
      vec2 chromaOffset = chromaDirection * chromaMask;
      vec2 safeUv = clamp(uv, 0.0, 1.0);
      vec3 color = vec3(
        texture2D(u_image, clamp(safeUv + chromaOffset, 0.0, 1.0)).r,
        texture2D(u_image, safeUv).g,
        texture2D(u_image, clamp(safeUv - chromaOffset, 0.0, 1.0)).b
      );
      float inhale = 0.5 - 0.5 * cos(u_progress * 6.28318530718);
      float irregularPulse = 0.86 + 0.14 * sin(loopAngle * 3.0 + imageTopPx.y * 0.035);
      vec3 gold = vec3(1.0, 0.55, 0.16);
      color += gold * ringMask * (0.045 + inhale * 0.105 + charge * 0.16 + impact * 0.31) * irregularPulse;
      color += vec3(1.0, 0.73, 0.4) * shockRing * 0.27;

      float debrisRelief = 0.0;
      debrisRelief += objectPresence(imageTopPx, vec2(390.0, 145.0), vec2(53.0, 48.0));
      debrisRelief += objectPresence(imageTopPx, vec2(488.0, 430.0), vec2(47.0, 58.0));
      debrisRelief += objectPresence(imageTopPx, vec2(246.0, 505.0), vec2(69.0, 59.0));
      debrisRelief += objectPresence(imageTopPx, vec2(1284.0, 350.0), vec2(67.0, 64.0));
      debrisRelief += objectPresence(imageTopPx, vec2(1456.0, 516.0), vec2(57.0, 46.0));
      debrisRelief += objectPresence(imageTopPx, vec2(1540.0, 605.0), vec2(72.0, 58.0));
      color += gold * debrisRelief * (0.012 + gravity * 0.026 + impact * 0.026);

      float leftCloudSource = softMask(ellipse(imageTopPx, vec2(438.0, 386.0), vec2(168.0, 104.0)), 0.05, 1.0);
      float upperCloudSource = softMask(ellipse(imageTopPx, vec2(815.0, 145.0), vec2(205.0, 128.0)), 0.08, 1.0);
      float cloudRays = 0.0;
      cloudRays += softBeam(imageTopPx, vec2(425.0, 365.0), vec2(-0.22, 1.0), 118.0, 610.0) * 0.62;
      cloudRays += softBeam(imageTopPx, vec2(438.0, 365.0), vec2(0.08, 1.0), 92.0, 650.0) * 0.84;
      cloudRays += softBeam(imageTopPx, vec2(455.0, 360.0), vec2(0.34, 1.0), 132.0, 620.0) * 0.56;
      cloudRays += softBeam(imageTopPx, vec2(820.0, 112.0), vec2(-0.15, 1.0), 125.0, 590.0) * 0.42;
      cloudRays += softBeam(imageTopPx, vec2(850.0, 105.0), vec2(0.2, 1.0), 145.0, 600.0) * 0.34;
      float rayTexture = 0.78 + 0.22 * sin(imageTopPx.x * 0.021 + imageTopPx.y * 0.008 - loopAngle);
      float skyEnergy = min(1.0, leftCloudSource * 0.52 + upperCloudSource * 0.22 + cloudRays * rayTexture * skyMask);
      color += vec3(1.0, 0.61, 0.25) * skyEnergy * (0.026 + skyBreath * 0.078 + impact * 0.035);
      color += vec3(1.0, 0.83, 0.58) * (leftCloudSource + upperCloudSource * 0.45) * (0.018 + gravity * 0.04);

      float innerGlow = softMask(ellipse(imageTopPx, portalCenter, vec2(113.0, 265.0)), 0.1, 1.0);
      color += vec3(1.0, 0.64, 0.27) * innerGlow * (inhale * 0.025 + charge * 0.08 + impact * 0.24);
      color += vec3(1.0, 0.56, 0.2) * impact * softMask(portalDistance, 0.15, 2.7) * 0.055;

      float vignette = smoothstep(1.18, 0.28, distance(v_uv, vec2(0.56, 0.51)));
      color *= 0.92 + vignette * 0.08;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function initializeWebGL(image) {
    const gl = worldCanvas.getContext("webgl", { alpha: false, antialias: true });
    if (!gl) throw new Error("WebGL no está disponible en este navegador.");

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vertexShader);
    gl.attachShader(glProgram, fragmentShader);
    gl.linkProgram(glProgram);
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(glProgram));
    }
    gl.useProgram(glProgram);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(glProgram, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    uniforms = {
      resolution: gl.getUniformLocation(glProgram, "u_resolution"),
      imageResolution: gl.getUniformLocation(glProgram, "u_imageResolution"),
      time: gl.getUniformLocation(glProgram, "u_time"),
      progress: gl.getUniformLocation(glProgram, "u_progress"),
      explosionProgress: gl.getUniformLocation(glProgram, "u_explosionProgress"),
    };
    gl.uniform2f(uniforms.imageResolution, IMAGE_WIDTH, IMAGE_HEIGHT);
    return gl;
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function createParticles() {
    const density = Math.min(1450, Math.round((window.innerWidth * window.innerHeight) / 1450));
    particles = Array.from({ length: density }, (_, index) => {
      const angle = Math.random() * Math.PI * 2;
      return {
        angle,
        radiusX: randomBetween(175, 520),
        radiusY: randomBetween(245, 585),
        phase: Math.random(),
        size: index % 19 === 0 ? randomBetween(1.25, 2.2) : randomBetween(0.25, 1.15),
        alpha: randomBetween(0.16, 0.82),
        drift: randomBetween(-0.12, 0.12),
        warmth: Math.random(),
        depth: Math.pow(Math.random(), 1.65),
        electric: index % 5 === 0 || Math.random() > 0.86,
        electricPhase: Math.random() * Math.PI * 2,
        electricTone: Math.random(),
      };
    });
  }

  function createFlashGrains() {
    const density = Math.min(
      1250,
      Math.round((window.innerWidth * window.innerHeight) / 1750)
    );
    flashGrains = Array.from({ length: density }, () => ({
      angle: Math.random() * Math.PI * 2,
      radiusX: randomBetween(210, 1140),
      radiusY: randomBetween(285, 790),
      phase: Math.random(),
      speed: randomBetween(0.72, 1.34),
      drift: randomBetween(-0.16, 0.16),
      depth: Math.pow(Math.random(), 1.45),
      size: randomBetween(0.45, 1.15),
      alpha: randomBetween(0.38, 0.98),
      twinkle: randomBetween(15, 29),
      tone: Math.random(),
      halo: Math.random() > 0.91,
    }));
  }

  function createSceneTwoRain() {
    const density = Math.min(520, Math.round(window.innerWidth / 3.1));
    sceneTwoRain = Array.from({ length: density }, () => ({
      x: Math.random(),
      y: Math.random(),
      depth: Math.pow(Math.random(), 1.35),
      speed: randomBetween(0.09, 0.23),
      size: randomBetween(0.5, 1.7),
      alpha: randomBetween(0.1, 0.4),
      drift: randomBetween(-0.014, 0.008),
      phase: Math.random() * Math.PI * 2,
    }));

    const dropDensity = Math.min(
      1300,
      Math.round((window.innerWidth * window.innerHeight) / 900)
    );
    sceneTwoRainDrops = Array.from({ length: dropDensity }, () => ({
      x: Math.random(),
      y: Math.random(),
      depth: Math.pow(Math.random(), 1.5),
      speed: randomBetween(0.024, 0.09),
      drift: randomBetween(-0.009, 0.012),
      size: randomBetween(0.42, 1.65),
      alpha: randomBetween(0.07, 0.34),
      twinkle: randomBetween(0.6, 1.8),
      phase: Math.random() * Math.PI * 2,
    }));

    const parkEnergyDensity = Math.min(300, Math.round(window.innerWidth / 4.2));
    sceneTwoParkEnergy = Array.from({ length: parkEnergyDensity }, (_, index) => ({
      x: randomBetween(590, 1635),
      y: randomBetween(570, 735),
      phase: Math.random(),
      speed: randomBetween(0.035, 0.095),
      lift: randomBetween(42, 170),
      drift: randomBetween(8, 38),
      size: randomBetween(0.55, 1.85),
      alpha: randomBetween(0.08, 0.3),
      frequencyIndex: 3 + (index * 7) % 40,
    }));

    sceneTwoDebris = Array.from({ length: 48 }, (_, index) => ({
      x: randomBetween(130, 1270),
      y: randomBetween(735, 910),
      phase: Math.random(),
      speed: randomBetween(0.018, 0.045),
      lift: randomBetween(16, 58),
      drift: randomBetween(20, 74),
      size: index % 6 === 0 ? randomBetween(5, 8) : randomBetween(2.5, 5.5),
      spin: randomBetween(1.2, 3.8),
      alpha: randomBetween(0.08, 0.24),
      warmth: Math.random(),
    }));

    const buildingShapes = [
      [570, 448, 48, 145], [628, 405, 42, 184], [680, 458, 58, 132],
      [748, 423, 46, 166], [806, 446, 58, 143], [875, 410, 40, 178],
      [928, 455, 62, 132], [1002, 408, 44, 176], [1060, 442, 55, 146],
      [1128, 422, 46, 164], [1185, 448, 58, 138], [1450, 444, 62, 150],
      [1524, 420, 54, 176], [1590, 452, 58, 138],
    ];
    sceneTwoBuildingLights = buildingShapes.flatMap(([x, y, buildingWidth, buildingHeight], buildingIndex) => {
      const columns = Math.max(2, Math.floor(buildingWidth / 11));
      const rows = Math.max(4, Math.floor(buildingHeight / 18));
      const lights = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if ((row + column + buildingIndex) % 3 === 0 || Math.random() > 0.58) continue;
          lights.push({
            x: x + 6 + column * ((buildingWidth - 12) / Math.max(1, columns - 1)),
            y: y + 9 + row * ((buildingHeight - 18) / Math.max(1, rows - 1)),
            phase: Math.random() * Math.PI * 2,
            speed: randomBetween(0.38, 1.15),
            warmth: Math.random(),
            size: randomBetween(0.65, 1.45),
            frequencyIndex: 3 + ((buildingIndex * 5 + column * 3 + row) % 42),
          });
        }
      }
      return lights;
    });
  }

  function getCoverTransform() {
    const scale = Math.max(window.innerWidth / IMAGE_WIDTH, window.innerHeight / IMAGE_HEIGHT);
    return {
      scale,
      offsetX: (window.innerWidth - IMAGE_WIDTH * scale) / 2,
      offsetY: (window.innerHeight - IMAGE_HEIGHT * scale) / 2,
    };
  }

  function drawParticles(seconds) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const { scale, offsetX, offsetY } = getCoverTransform();
    const centerX = offsetX + 1003 * scale;
    const centerY = offsetY + 410 * scale;
    const explosionProgress = (seconds % EXPLOSION_SECONDS) / EXPLOSION_SECONDS;
    const impactDistance = Math.abs(explosionProgress - 0.52);
    const impact = impactDistance < 0.3
      ? Math.pow(1 - impactDistance / 0.3, 2)
      : 0;
    const soundDrive = Math.min(
      1,
      Math.pow(audioEnergy * 0.76 + audioPeak * 0.68, 0.78) * 1.18
    );
    particleContext.clearRect(0, 0, width, height);
    particleContext.globalCompositeOperation = "lighter";

    for (const particle of particles) {
      const cycle = (particle.phase + seconds / LOOP_SECONDS) % 1;
      const inward = 1 - cycle * (0.2 + particle.depth * 0.31) - impact * (0.045 + particle.depth * 0.105);
      const turn = particle.angle + cycle * particle.drift * (0.55 + particle.depth * 1.18);
      const x = centerX + Math.cos(turn) * particle.radiusX * inward * scale;
      const y = centerY + Math.sin(turn) * particle.radiusY * inward * scale;
      const edgeDistance = Math.abs(Math.sqrt(
        Math.pow((x - centerX) / (174 * scale), 2) +
        Math.pow((y - centerY) / (371 * scale), 2)
      ) - 1);
      const edgeGlow = Math.max(0, 1 - edgeDistance * 2.1);
      const lifeFade = Math.sin(cycle * Math.PI);
      const alpha = particle.alpha * (0.25 + edgeGlow * 0.75) * lifeFade;
      if (alpha < 0.015) continue;

      const radius = particle.size * scale * (0.48 + particle.depth * 1.48 + edgeGlow * 0.55);
      if (particle.electric && particle.depth > 0.18) {
        const deltaX = x - centerX;
        const deltaY = y - centerY;
        const distance = Math.max(1, Math.hypot(deltaX, deltaY));
        const inwardX = -deltaX / distance;
        const inwardY = -deltaY / distance;
        const normalX = -inwardY;
        const normalY = inwardX;
        const flashCycle = (
          seconds * (2.8 + particle.depth * 2.2)
          + particle.electricPhase / (Math.PI * 2)
        ) % 1;
        const flashWindow = 0.28 + soundDrive * 0.18;
        if (flashCycle > flashWindow) continue;
        const flicker = Math.pow(1 - flashCycle / flashWindow, 0.55);
        const boltLength = Math.max(0.7, radius * 2);
        const bend = Math.min(boltLength * 0.18, scale * 0.62);
        const segments = 3;
        const points = [];

        for (let segment = 0; segment <= segments; segment += 1) {
          const progress = segment / segments;
          const taper = Math.sin(progress * Math.PI);
          const jitter = segment === 0 || segment === segments
            ? 0
            : Math.sin(particle.electricPhase * 3.1 + segment * 7.91)
              * bend
              * taper
              * (segment % 2 === 0 ? -1 : 1);
          points.push({
            x: x + inwardX * boltLength * progress + normalX * jitter,
            y: y + inwardY * boltLength * progress + normalY * jitter,
          });
        }

        let core = [255, 190, 92];
        if (particle.electricTone > 0.93 && particle.electricTone <= 0.975) {
          core = [255, 112, 49];
        } else if (particle.electricTone > 0.975 && particle.electricTone <= 0.992) {
          core = [255, 82, 61];
        } else if (particle.electricTone > 0.992) {
          core = [188, 207, 220];
        }

        const traceBolt = () => {
          particleContext.beginPath();
          particleContext.moveTo(points[0].x, points[0].y);
          for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
            particleContext.lineTo(points[pointIndex].x, points[pointIndex].y);
          }
        };
        particleContext.save();
        particleContext.lineCap = "round";
        particleContext.lineJoin = "round";
        particleContext.filter = `blur(${Math.max(0.4, scale * 0.72)}px)`;
        particleContext.strokeStyle = `rgba(255, 126, 32, ${alpha * (0.54 + soundDrive * 0.28) * flicker})`;
        particleContext.lineWidth = Math.max(0.42, Math.min(0.95, radius * (0.54 + soundDrive * 0.24)));
        traceBolt();
        particleContext.stroke();

        particleContext.filter = "none";
        particleContext.strokeStyle = `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${alpha * (0.84 + soundDrive * 0.16) * flicker})`;
        particleContext.lineWidth = Math.max(0.24, Math.min(0.58, scale * (0.28 + soundDrive * 0.18)));
        traceBolt();
        particleContext.stroke();
        particleContext.restore();
        continue;
      }

      particleContext.beginPath();
      particleContext.fillStyle = particle.warmth > 0.55
        ? `rgba(255, 181, 73, ${alpha * 0.82})`
        : `rgba(255, 217, 158, ${alpha * 0.68})`;
      particleContext.arc(x, y, radius, 0, Math.PI * 2);
      particleContext.fill();
    }

  }

  function drawHumanEnergyField(seconds) {
    const { scale, offsetX, offsetY } = getCoverTransform();
    const centerX = offsetX + 692 * scale;
    const centerY = offsetY + 650 * scale;
    const topY = offsetY + 402 * scale;
    const bottomY = offsetY + 866 * scale;
    const loopPhase = seconds / LOOP_SECONDS * Math.PI * 2;
    const breath = 0.5 - 0.5 * Math.cos(loopPhase);
    const power = Math.min(1, 0.62 + breath * 0.16 + audioEnergy * 0.22 + audioPeak * 0.2);

    const traceAura = (expansion, phaseOffset) => {
      const steps = 18;
      particleContext.beginPath();
      particleContext.moveTo(centerX, bottomY);
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        const y = bottomY - (bottomY - topY) * progress;
        const profile = Math.pow(Math.sin(progress * Math.PI), 0.64);
        const width = scale * (18 + profile * 68) * expansion;
        const flame = scale * (
          Math.sin(seconds * 3.1 + step * 1.73 + phaseOffset) * (2.8 + power * 4.4)
          + Math.sin(seconds * 5.7 - step * 0.91) * 1.8
        );
        particleContext.lineTo(centerX - width - flame, y);
      }
      for (let step = steps; step >= 0; step -= 1) {
        const progress = step / steps;
        const y = bottomY - (bottomY - topY) * progress;
        const profile = Math.pow(Math.sin(progress * Math.PI), 0.64);
        const width = scale * (18 + profile * 68) * expansion;
        const flame = scale * (
          Math.sin(seconds * 3.5 + step * 1.49 + phaseOffset + 2.1) * (2.8 + power * 4.2)
          + Math.sin(seconds * 6.1 - step * 1.07) * 1.7
        );
        particleContext.lineTo(centerX + width + flame, y);
      }
      particleContext.closePath();
    };

    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    const auraGradient = particleContext.createLinearGradient(centerX, bottomY, centerX, topY);
    auraGradient.addColorStop(0, `rgba(255, 111, 24, ${0.18 + power * 0.12})`);
    auraGradient.addColorStop(0.42, `rgba(255, 174, 50, ${0.2 + power * 0.16})`);
    auraGradient.addColorStop(0.78, `rgba(255, 224, 139, ${0.16 + power * 0.14})`);
    auraGradient.addColorStop(1, "rgba(174, 205, 255, 0.08)");

    particleContext.filter = `blur(${Math.max(12, scale * 25)}px)`;
    particleContext.fillStyle = auraGradient;
    traceAura(1.16 + breath * 0.06, 0);
    particleContext.fill();

    particleContext.filter = `blur(${Math.max(6, scale * 11)}px)`;
    particleContext.globalAlpha = 0.72;
    traceAura(0.88 + power * 0.05, 1.7);
    particleContext.fill();
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "destination-out";
    particleContext.filter = `blur(${Math.max(3, scale * 5.5)}px)`;
    particleContext.fillStyle = "rgba(0, 0, 0, 0.96)";
    particleContext.beginPath();
    particleContext.ellipse(offsetX + 710 * scale, offsetY + 465 * scale, 31 * scale, 35 * scale, 0, 0, Math.PI * 2);
    particleContext.ellipse(offsetX + 691 * scale, offsetY + 590 * scale, 57 * scale, 124 * scale, 0, 0, Math.PI * 2);
    particleContext.ellipse(offsetX + 672 * scale, offsetY + 775 * scale, 27 * scale, 166 * scale, -0.03, 0, Math.PI * 2);
    particleContext.ellipse(offsetX + 705 * scale, offsetY + 775 * scale, 27 * scale, 166 * scale, 0.04, 0, Math.PI * 2);
    particleContext.fill();
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    for (const dust of humanDust) {
      const cycle = (dust.phase + seconds / LOOP_SECONDS * dust.speed) % 1;
      const orbitAngle = dust.angle + seconds * dust.drift * 0.18 + cycle * 0.32;
      const lift = cycle * scale * (22 + dust.depth * 44);
      const radiusPull = 1 - cycle * (0.08 + power * 0.09);
      const x = centerX + Math.cos(orbitAngle) * dust.radiusX * radiusPull * scale;
      const y = centerY + Math.sin(orbitAngle) * dust.radiusY * radiusPull * scale - lift;
      const life = Math.sin(cycle * Math.PI);
      const flicker = 0.58 + 0.42 * Math.max(0, Math.sin(seconds * 18 + dust.phase * 31));
      const alpha = dust.alpha * life * flicker * (0.38 + power * 0.46);
      const size = Math.max(0.36, dust.size * scale * (0.72 + dust.depth * 0.7));
      const cool = dust.tone > 0.94;
      particleContext.beginPath();
      particleContext.fillStyle = cool
        ? `rgba(177, 207, 255, ${alpha * 0.72})`
        : `rgba(255, ${Math.round(151 + dust.tone * 68)}, ${Math.round(42 + dust.tone * 72)}, ${alpha})`;
      particleContext.arc(x, y, size, 0, Math.PI * 2);
      particleContext.fill();
    }
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "source-over";
    for (const rock of humanRocks) {
      const angle = rock.angle + seconds * rock.speed;
      const bob = Math.sin(seconds * 0.8 + rock.phase * Math.PI * 2) * scale * (3 + rock.depth * 5);
      const x = centerX + Math.cos(angle) * rock.radiusX * scale;
      const y = centerY + Math.sin(angle) * rock.radiusY * scale + bob;
      const rockSize = rock.size * scale * (0.72 + rock.depth * 0.72);
      const rotation = rock.rotation + seconds * rock.spin;
      particleContext.save();
      particleContext.translate(x, y);
      particleContext.rotate(rotation);
      particleContext.shadowColor = `rgba(255, 137, 38, ${0.2 + power * 0.26})`;
      particleContext.shadowBlur = Math.max(2, rockSize * 0.7);
      particleContext.beginPath();
      for (let side = 0; side < rock.sides; side += 1) {
        const theta = side / rock.sides * Math.PI * 2;
        const irregularity = 0.72 + 0.28 * Math.sin(rock.phase * 17 + side * 4.13);
        const px = Math.cos(theta) * rockSize * irregularity;
        const py = Math.sin(theta) * rockSize * irregularity * 0.76;
        if (side === 0) particleContext.moveTo(px, py);
        else particleContext.lineTo(px, py);
      }
      particleContext.closePath();
      particleContext.fillStyle = "rgba(31, 25, 22, 0.94)";
      particleContext.fill();
      particleContext.shadowBlur = 0;
      particleContext.beginPath();
      particleContext.moveTo(rockSize * 0.72, 0);
      particleContext.lineTo(rockSize * 0.12, -rockSize * 0.52);
      particleContext.strokeStyle = `rgba(255, 172, 81, ${0.2 + power * 0.22})`;
      particleContext.lineWidth = Math.max(0.28, scale * 0.42);
      particleContext.stroke();
      particleContext.restore();
    }
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    particleContext.lineCap = "round";
    particleContext.lineJoin = "round";
    const bodyContourWidth = (position) => {
      const shoulders = 31 * Math.exp(-Math.pow((position - 0.68) / 0.22, 2));
      const hipsAndLegs = 12 * Math.exp(-Math.pow((position - 0.3) / 0.2, 2));
      return 30 + shoulders + hipsAndLegs;
    };
    for (const arc of humanArcs) {
      const travel = (arc.phase + seconds * arc.speed) % 1;
      const endTravel = Math.min(1, travel + arc.length / 390);
      const startWidth = (bodyContourWidth(travel) + arc.outset) * scale;
      const endWidth = (bodyContourWidth(endTravel) + arc.outset) * scale;
      const startX = centerX + arc.side * startWidth;
      const startY = offsetY + (842 - travel * 390) * scale;
      const endX = centerX + arc.side * endWidth;
      const endY = offsetY + (842 - endTravel * 390) * scale;
      const bend = arc.bend * scale * (
        0.82 + 0.18 * Math.sin(seconds * 0.42 + arc.pulse)
      );
      const slowPulse = 0.78 + 0.22 * Math.sin(seconds * 0.36 + arc.pulse);
      const edgeFade = Math.pow(Math.sin(travel * Math.PI), 0.34);
      const energy = edgeFade * slowPulse * (0.58 + power * 0.34);
      const points = [
        [startX, startY],
        [startX * 0.68 + endX * 0.32 + arc.side * bend, startY * 0.68 + endY * 0.32],
        [startX * 0.34 + endX * 0.66 - arc.side * bend * 0.62, startY * 0.34 + endY * 0.66],
        [endX, endY],
      ];
      const traceArc = () => {
        particleContext.beginPath();
        particleContext.moveTo(points[0][0], points[0][1]);
        for (let index = 1; index < points.length; index += 1) {
          particleContext.lineTo(points[index][0], points[index][1]);
        }
      };
      const core = arc.cool ? [171, 207, 255] : [255, 211, 117];
      particleContext.filter = `blur(${Math.max(1, scale * 1.8)}px)`;
      particleContext.strokeStyle = `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${energy * 0.42})`;
      particleContext.lineWidth = Math.max(0.9, scale * 1.8);
      traceArc();
      particleContext.stroke();
      particleContext.filter = "none";
      particleContext.strokeStyle = `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${energy * 0.88})`;
      particleContext.lineWidth = Math.max(0.36, scale * 0.62);
      traceArc();
      particleContext.stroke();
    }
    particleContext.restore();
  }

  function resize(gl) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    for (const canvas of [worldCanvas, particleCanvas]) {
      canvas.width = Math.round(window.innerWidth * pixelRatio);
      canvas.height = Math.round(window.innerHeight * pixelRatio);
    }
    worldCanvas.style.width = particleCanvas.style.width = `${window.innerWidth}px`;
    worldCanvas.style.height = particleCanvas.style.height = `${window.innerHeight}px`;
    particleContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    gl.viewport(0, 0, worldCanvas.width, worldCanvas.height);
    gl.uniform2f(uniforms.resolution, window.innerWidth, window.innerHeight);
    createParticles();
    createFlashGrains();
    createSceneTwoRain();
  }

  function getElapsedSeconds(now) {
    return (now - startTime) / 1000;
  }

  function initializeAudioAnalysis() {
    if (audioContext) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext = new AudioContext();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 128;
    audioAnalyser.smoothingTimeConstant = 0.78;
    audioFrequencyData = new Uint8Array(audioAnalyser.frequencyBinCount);
    const source = audioContext.createMediaElementSource(soundtrack);
    source.connect(audioAnalyser);
    audioAnalyser.connect(audioContext.destination);
  }

  function updateAudioAnalysis() {
    if (!audioAnalyser || !audioFrequencyData || soundtrack.paused) {
      audioEnergy *= 0.9;
      audioPeak *= 0.86;
      audioBass *= 0.88;
      audioBassFlash *= 0.82;
      return;
    }
    audioAnalyser.getByteFrequencyData(audioFrequencyData);
    let frequencyTotal = 0;
    let framePeak = 0;
    let bassTotal = 0;
    const lastBassFrequency = Math.min(8, audioFrequencyData.length - 1);
    for (let index = 1; index <= lastBassFrequency; index += 1) {
      bassTotal += audioFrequencyData[index];
    }
    const lastFrequency = Math.min(42, audioFrequencyData.length - 1);
    for (let index = 2; index <= lastFrequency; index += 1) {
      frequencyTotal += audioFrequencyData[index];
      framePeak = Math.max(framePeak, audioFrequencyData[index] / 255);
    }
    const targetEnergy = frequencyTotal / ((lastFrequency - 1) * 255);
    const targetBass = bassTotal / (lastBassFrequency * 255);
    audioEnergy += (targetEnergy - audioEnergy) * 0.24;
    const peakResponse = framePeak > audioPeak ? 0.38 : 0.1;
    audioPeak += (framePeak - audioPeak) * peakResponse;
    const previousBass = audioBass;
    audioBass += (targetBass - audioBass) * 0.34;
    const bassTransient = Math.max(0, targetBass - previousBass - 0.025);
    const bassWeight = Math.max(0, (targetBass - 0.2) / 0.65);
    const targetFlash = Math.min(1, bassTransient * 3.8 + bassWeight * 0.12);
    const flashResponse = targetFlash > audioBassFlash ? 0.58 : 0.085;
    audioBassFlash += (targetFlash - audioBassFlash) * flashResponse;
  }

  function getReactiveColor(level) {
    if (level < 0.5) {
      const warmMix = level / 0.5;
      return {
        red: 255,
        green: Math.round(202 - warmMix * 162),
        blue: Math.round(72 - warmMix * 50),
      };
    }

    const hotMix = (level - 0.5) / 0.5;
    return {
      red: Math.round(255 - hotMix * 205),
      green: Math.round(40 + hotMix * 94),
      blue: Math.round(22 + hotMix * 233),
    };
  }

  function drawBassFlash(seconds) {
    if (audioBassFlash < 0.008) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const { scale, offsetX, offsetY } = getCoverTransform();
    const centerX = offsetX + 1003 * scale;
    const centerY = offsetY + 410 * scale;
    const colorLevel = Math.min(
      1,
      Math.pow(audioEnergy * 0.78 + audioPeak * 0.62, 0.72) * 1.52
    );
    const { red, green, blue } = getReactiveColor(colorLevel);
    const flash = Math.pow(audioBassFlash, 1.15);
    const radius = Math.hypot(width, height) * 0.72;

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.fillStyle = `rgba(${red}, ${green}, ${blue}, ${flash * 0.044})`;
    particleContext.fillRect(0, 0, width, height);

    const glow = particleContext.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      radius
    );
    glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${flash * 0.112})`);
    glow.addColorStop(0.34, `rgba(${red}, ${green}, ${blue}, ${flash * 0.068})`);
    glow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    particleContext.fillStyle = glow;
    particleContext.fillRect(0, 0, width, height);

    for (const grain of flashGrains) {
      const cycle = (grain.phase + seconds / LOOP_SECONDS * grain.speed) % 1;
      const inward = 1
        - cycle * (0.28 + grain.depth * 0.38)
        - flash * (0.018 + grain.depth * 0.052);
      const turn = grain.angle + cycle * grain.drift;
      const grainX = centerX + Math.cos(turn) * grain.radiusX * inward * scale;
      const grainY = centerY + Math.sin(turn) * grain.radiusY * inward * scale;
      if (grainX < -3 || grainX > width + 3 || grainY < -3 || grainY > height + 3) continue;

      const lifeFade = Math.sin(cycle * Math.PI);
      const twinkle = 0.34 + Math.max(0, Math.sin(seconds * grain.twinkle + grain.phase * 19)) * 0.66;
      const grainAlpha = flash * grain.alpha * lifeFade * twinkle * 0.94;
      if (grainAlpha < 0.012) continue;

      let grainRed = red;
      let grainGreen = green;
      let grainBlue = blue;
      if (grain.tone > 0.9 && grain.tone <= 0.97) {
        grainGreen = Math.round(green * 0.74 + 112 * 0.26);
        grainBlue = Math.round(blue * 0.74 + 34 * 0.26);
      } else if (grain.tone > 0.97 && grain.tone <= 0.992) {
        grainGreen = Math.round(green * 0.8 + 75 * 0.2);
        grainBlue = Math.round(blue * 0.8 + 55 * 0.2);
      } else if (grain.tone > 0.992) {
        grainRed = Math.round(red * 0.82 + 188 * 0.18);
        grainGreen = Math.round(green * 0.82 + 207 * 0.18);
        grainBlue = Math.round(blue * 0.82 + 220 * 0.18);
      }

      const grainSize = Math.max(0.42, grain.size * scale * (0.82 + grain.depth * 0.58));

      if (grain.halo) {
        particleContext.beginPath();
        particleContext.fillStyle = `rgba(${grainRed}, ${grainGreen}, ${grainBlue}, ${grainAlpha * 0.14})`;
        particleContext.arc(grainX, grainY, grainSize * 2.6, 0, Math.PI * 2);
        particleContext.fill();
      }

      particleContext.beginPath();
      particleContext.fillStyle = `rgba(${grainRed}, ${grainGreen}, ${grainBlue}, ${grainAlpha})`;
      particleContext.arc(grainX, grainY, grainSize, 0, Math.PI * 2);
      particleContext.fill();
    }
    particleContext.restore();
  }

  function drawPortalEqualizer(seconds) {
    if (!audioFrequencyData || audioEnergy < 0.012) return;

    const { scale, offsetX, offsetY } = getCoverTransform();
    const centerX = offsetX + 1003 * scale;
    const centerY = offsetY + 410 * scale;
    const visualLevel = Math.min(1, Math.pow(audioEnergy * 0.78 + audioPeak * 0.62, 0.78) * 1.24);
    const expansionX = scale * (4 + visualLevel * 48);
    const expansionY = scale * (7 + visualLevel * 76);
    const { red, green, blue } = getReactiveColor(visualLevel);

    const auraColor = `rgba(${red}, ${green}, ${blue}, ${0.25 + visualLevel * 0.52})`;
    particleContext.save();
    particleContext.globalCompositeOperation = "source-over";
    particleContext.lineCap = "round";

    particleContext.filter = `blur(${Math.max(9, scale * (21 + visualLevel * 34))}px)`;
    particleContext.strokeStyle = auraColor;
    particleContext.lineWidth = scale * (28 + visualLevel * 47);
    particleContext.globalAlpha = 0.34 + visualLevel * 0.29;
    particleContext.beginPath();
    particleContext.ellipse(
      centerX,
      centerY,
      151 * scale + expansionX * 1.08,
      337 * scale + expansionY * 1.08,
      0,
      0,
      Math.PI * 2
    );
    particleContext.stroke();

    particleContext.filter = `blur(${Math.max(7, scale * (12 + visualLevel * 20))}px)`;
    particleContext.lineWidth = scale * (16 + visualLevel * 32);
    particleContext.globalAlpha = 0.42 + visualLevel * 0.38;
    particleContext.beginPath();
    particleContext.ellipse(
      centerX,
      centerY,
      145 * scale + expansionX * 0.72,
      326 * scale + expansionY * 0.72,
      0,
      0,
      Math.PI * 2
    );
    particleContext.stroke();
    particleContext.restore();
  }

  function drawStationScene(seconds) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const { scale, offsetX, offsetY } = getCoverTransform();
    const visualLevel = Math.min(1, Math.pow(audioEnergy * 0.9 + audioPeak * 0.72, 0.72) * 1.58);
    const bassLevel = Math.min(1, audioBass * 1.3 + audioBassFlash * 0.95);
    const ambientPulse = 0.5 + 0.5 * Math.sin(seconds * 0.42);
    const imageX = (value) => offsetX + value * scale;
    const imageY = (value) => offsetY + value * scale;
    const getFrequencyLevel = (frequencyIndex, sampleRadius = 2) => {
      if (!audioFrequencyData || audioFrequencyData.length === 0) return 0;
      let total = 0;
      let samples = 0;
      for (let offset = -sampleRadius; offset <= sampleRadius; offset += 1) {
        const index = Math.max(0, Math.min(audioFrequencyData.length - 1, frequencyIndex + offset));
        total += audioFrequencyData[index] / 255;
        samples += 1;
      }
      return total / samples;
    };

    particleContext.clearRect(0, 0, width, height);

    const cloudBands = [
      [745, 150, 420, 112, 0.045, 0.2],
      [1210, 112, 365, 98, -0.038, 1.7],
      [1060, 330, 510, 84, 0.027, 3.3],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.filter = `blur(${Math.max(18, 32 * scale)}px)`;
    for (const [x, y, radiusX, radiusY, speed, phase] of cloudBands) {
      const drift = Math.sin(seconds * speed + phase) * 96;
      const cloud = particleContext.createRadialGradient(
        imageX(x + drift), imageY(y), 0,
        imageX(x + drift), imageY(y), radiusX * scale
      );
      cloud.addColorStop(0, `rgba(104, 139, 158, ${0.026 + ambientPulse * 0.014})`);
      cloud.addColorStop(0.48, "rgba(83, 119, 142, 0.018)");
      cloud.addColorStop(1, "rgba(52, 79, 101, 0)");
      particleContext.fillStyle = cloud;
      particleContext.beginPath();
      particleContext.ellipse(
        imageX(x + drift), imageY(y), radiusX * scale, radiusY * scale, 0, 0, Math.PI * 2
      );
      particleContext.fill();
    }
    particleContext.restore();

    const helicopterX = imageX(1023 + Math.sin(seconds * 0.31) * 3.2);
    const helicopterY = imageY(245 + Math.sin(seconds * 0.43 + 1.1) * 2.1);
    const beamAngle = 0.12 + Math.sin(seconds * 0.19) * 0.055;
    const beamEndX = imageX(1110 + Math.sin(seconds * 0.19) * 48);
    const beamEndY = imageY(570);
    const cameraFlashPhase = (seconds + 7.2) % 11;
    const cameraFlashStrength = cameraFlashPhase < 1
      ? Math.pow(Math.sin(cameraFlashPhase * Math.PI), 0.72)
      : 0;
    const groundBeamVisibility = 1 - cameraFlashStrength * 0.74;
    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.filter = `blur(${Math.max(8, 13 * scale)}px)`;
    const searchlight = particleContext.createLinearGradient(
      helicopterX, helicopterY, beamEndX, beamEndY
    );
    searchlight.addColorStop(0, `rgba(202, 233, 255, ${(0.18 + ambientPulse * 0.05) * groundBeamVisibility})`);
    searchlight.addColorStop(0.46, `rgba(143, 200, 231, ${0.07 * groundBeamVisibility})`);
    searchlight.addColorStop(1, "rgba(96, 160, 197, 0)");
    particleContext.fillStyle = searchlight;
    particleContext.beginPath();
    particleContext.moveTo(helicopterX - 5 * scale, helicopterY + 3 * scale);
    particleContext.lineTo(beamEndX - (72 + beamAngle * 90) * scale, beamEndY);
    particleContext.lineTo(beamEndX + (72 + beamAngle * 90) * scale, beamEndY);
    particleContext.closePath();
    particleContext.fill();
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.filter = `blur(${Math.max(7, 12 * scale)}px)`;
    for (let wash = 0; wash < 3; wash += 1) {
      const washPhase = seconds * (0.62 + wash * 0.08) + wash * 2.2;
      particleContext.beginPath();
      particleContext.ellipse(
        helicopterX + Math.sin(washPhase) * 32 * scale,
        helicopterY + (18 + wash * 9) * scale,
        (58 + wash * 22) * scale,
        (7 + wash * 3) * scale,
        Math.sin(washPhase * 0.4) * 0.12,
        0,
        Math.PI * 2
      );
      particleContext.strokeStyle = `rgba(145, 188, 211, ${0.026 + wash * 0.008})`;
      particleContext.lineWidth = Math.max(1, 2.2 * scale);
      particleContext.stroke();
    }
    particleContext.restore();

    const stormDuration = 8.6;
    const stormCycle = Math.floor(seconds / stormDuration);
    const stormPhase = seconds % stormDuration;
    const strikePhase = stormPhase - 3.35;
    const firstFlash = strikePhase >= 0 && strikePhase < 0.14
      ? Math.sin(strikePhase / 0.14 * Math.PI)
      : 0;
    const secondFlashPhase = strikePhase - 0.24;
    const secondFlash = secondFlashPhase >= 0 && secondFlashPhase < 0.26
      ? Math.sin(secondFlashPhase / 0.26 * Math.PI)
      : 0;
    const lightningStrength = Math.min(1, firstFlash * 0.72 + secondFlash + audioBassFlash * 0.24);
    if (lightningStrength > 0.012) {
      const seeded = (value) => {
        const noise = Math.sin(value * 12.9898 + stormCycle * 78.233) * 43758.5453;
        return noise - Math.floor(noise);
      };
      const strikeStartX = 710 + seeded(1) * 710;
      const strikeEndX = strikeStartX + (seeded(2) - 0.5) * 240;
      const strikeTop = 34 + seeded(3) * 76;
      const strikeBottom = 420 + seeded(4) * 95;
      const cloudGlow = particleContext.createRadialGradient(
        imageX(strikeStartX), imageY(strikeTop + 90), 0,
        imageX(strikeStartX), imageY(strikeTop + 90), 360 * scale
      );
      cloudGlow.addColorStop(0, `rgba(198, 228, 255, ${lightningStrength * 0.42})`);
      cloudGlow.addColorStop(0.42, `rgba(115, 170, 220, ${lightningStrength * 0.17})`);
      cloudGlow.addColorStop(1, "rgba(60, 94, 135, 0)");
      particleContext.save();
      particleContext.globalCompositeOperation = "screen";
      particleContext.fillStyle = cloudGlow;
      particleContext.fillRect(0, 0, width, height);
      particleContext.fillStyle = `rgba(113, 169, 216, ${lightningStrength * 0.055})`;
      particleContext.fillRect(0, 0, width, height);

      const traceBolt = () => {
        particleContext.beginPath();
        particleContext.moveTo(imageX(strikeStartX), imageY(strikeTop));
        for (let segment = 1; segment <= 13; segment += 1) {
          const progress = segment / 13;
          const center = strikeStartX + (strikeEndX - strikeStartX) * progress;
          const jitter = (seeded(segment + 10) - 0.5) * (58 - progress * 24);
          particleContext.lineTo(
            imageX(center + jitter),
            imageY(strikeTop + (strikeBottom - strikeTop) * progress)
          );
        }
      };
      particleContext.lineCap = "round";
      particleContext.lineJoin = "round";
      particleContext.filter = `blur(${Math.max(4, 7 * scale)}px)`;
      particleContext.strokeStyle = `rgba(126, 191, 255, ${lightningStrength * 0.58})`;
      particleContext.lineWidth = Math.max(2, 4.6 * scale);
      traceBolt();
      particleContext.stroke();
      particleContext.filter = "none";
      particleContext.strokeStyle = `rgba(231, 246, 255, ${lightningStrength * 0.88})`;
      particleContext.lineWidth = Math.max(0.55, 0.95 * scale);
      traceBolt();
      particleContext.stroke();
      particleContext.restore();
    }

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    for (let dropIndex = 0; dropIndex < sceneTwoRain.length; dropIndex += 1) {
      const drop = sceneTwoRain[dropIndex];
      const gravitySurge = 0.54 + bassLevel * 0.42 + visualLevel * 0.16;
      const travel = ((drop.y - seconds * drop.speed * gravitySurge) % 1.08 + 1.08) % 1.08;
      const x = ((drop.x + seconds * drop.drift + 1.08) % 1.08) * width;
      const y = travel * height;
      const shimmer = 0.68 + 0.32 * Math.sin(seconds * 2.1 + drop.phase);
      const radius = Math.max(0.34, drop.size * (0.48 + drop.depth * 0.82) * scale);
      particleContext.beginPath();
      particleContext.fillStyle = `rgba(191, 224, 239, ${drop.alpha * shimmer * (0.42 + drop.depth * 0.58)})`;
      particleContext.ellipse(x, y, radius * 0.55, radius * (1.05 + drop.depth * 0.75), -0.12, 0, Math.PI * 2);
      particleContext.fill();
    }

    for (const drop of sceneTwoRainDrops) {
      const travel = ((drop.y - seconds * drop.speed) % 1.06 + 1.06) % 1.06;
      const x = ((drop.x + seconds * drop.drift + 1.06) % 1.06) * width;
      const y = travel * height;
      const shimmer = 0.55 + 0.45 * Math.sin(seconds * drop.twinkle + drop.phase);
      const radius = Math.max(0.28, drop.size * (0.48 + drop.depth * 0.92) * scale);
      particleContext.beginPath();
      particleContext.fillStyle = `rgba(198, 226, 239, ${drop.alpha * shimmer * (0.42 + drop.depth * 0.58)})`;
      particleContext.arc(x, y, radius, 0, Math.PI * 2);
      particleContext.fill();
    }
    particleContext.restore();

    const parkZones = [
      [710, 615, 5], [890, 642, 12], [1080, 632, 19], [1260, 646, 27], [1450, 625, 35],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    particleContext.filter = `blur(${Math.max(7, 11 * scale)}px)`;
    for (let zoneIndex = 0; zoneIndex < parkZones.length; zoneIndex += 1) {
      const [x, y, frequencyIndex] = parkZones[zoneIndex];
      const frequency = Math.pow(getFrequencyLevel(frequencyIndex, 3), 0.92);
      const zonePulse = Math.min(1, frequency * 0.82 + visualLevel * 0.22 + bassLevel * 0.18);
      const radiusX = (120 + zonePulse * 75) * scale;
      const radiusY = (34 + zonePulse * 25) * scale;
      const glow = particleContext.createRadialGradient(imageX(x), imageY(y), 0, imageX(x), imageY(y), radiusX);
      glow.addColorStop(0, `rgba(89, 255, 191, ${0.018 + zonePulse * 0.11})`);
      glow.addColorStop(0.42, `rgba(39, 198, 181, ${zonePulse * 0.055})`);
      glow.addColorStop(1, "rgba(22, 112, 103, 0)");
      particleContext.fillStyle = glow;
      particleContext.beginPath();
      particleContext.ellipse(imageX(x), imageY(y), radiusX, radiusY, -0.015, 0, Math.PI * 2);
      particleContext.fill();
    }
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    for (const mote of sceneTwoParkEnergy) {
      const cycle = (mote.phase + seconds * mote.speed * (1 + bassLevel * 0.8)) % 1;
      const frequency = getFrequencyLevel(mote.frequencyIndex, 2);
      const liftFade = Math.pow(Math.sin(cycle * Math.PI), 0.72);
      const x = mote.x + Math.sin(cycle * Math.PI * 2 + mote.phase * 8) * mote.drift;
      const y = mote.y - cycle * mote.lift * (0.76 + visualLevel * 0.34);
      const radius = mote.size * (0.58 + frequency * 1.2) * scale;
      const alpha = mote.alpha * liftFade * (0.34 + frequency * 0.94 + bassLevel * 0.2);
      const green = Math.round(202 + frequency * 42);
      const blue = Math.round(166 + frequency * 67);
      particleContext.beginPath();
      particleContext.fillStyle = `rgba(101, ${green}, ${blue}, ${alpha})`;
      particleContext.arc(imageX(x), imageY(y), Math.max(0.45, radius), 0, Math.PI * 2);
      particleContext.fill();
      if (frequency > 0.46 && mote.size > 1.25) {
        const haloRadius = radius * 5;
        const halo = particleContext.createRadialGradient(imageX(x), imageY(y), 0, imageX(x), imageY(y), haloRadius);
        halo.addColorStop(0, `rgba(74, 239, 205, ${alpha * 0.24})`);
        halo.addColorStop(1, "rgba(45, 180, 170, 0)");
        particleContext.fillStyle = halo;
        particleContext.fillRect(imageX(x) - haloRadius, imageY(y) - haloRadius, haloRadius * 2, haloRadius * 2);
      }
    }

    for (let ringIndex = 0; ringIndex < 4; ringIndex += 1) {
      const cycle = (seconds * (0.075 + ringIndex * 0.006) + ringIndex * 0.23) % 1;
      const ringFrequency = getFrequencyLevel(5 + ringIndex * 9, 3);
      const ringAlpha = Math.sin(cycle * Math.PI) * (0.025 + ringFrequency * 0.11);
      particleContext.beginPath();
      particleContext.ellipse(
        imageX(1110), imageY(642),
        (100 + cycle * 520) * scale, (15 + cycle * 82) * scale,
        -0.015, 0, Math.PI * 2
      );
      particleContext.strokeStyle = `rgba(84, 239, 205, ${ringAlpha})`;
      particleContext.lineWidth = Math.max(0.5, (0.7 + ringFrequency * 1.4) * scale);
      particleContext.stroke();
    }
    particleContext.restore();

    const windCycle = seconds * 0.72;
    const windGust = 0.5 + 0.5 * Math.sin(windCycle);
    const windFlutter = Math.sin(seconds * 1.28 + Math.sin(seconds * 0.31)) * 0.5 + 0.5;
    const hairAnchors = [
      [1337, 367, 0.2], [1345, 360, 1.1], [1353, 358, 2.2],
      [1361, 361, 3.4], [1369, 368, 4.1], [1377, 378, 5.3],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.filter = `blur(${Math.max(0.35, 0.75 * scale)}px)`;
    for (const [anchorX, anchorY, phase] of hairAnchors) {
      const lift = Math.sin(seconds * 1.05 + phase) * 2.4 + windGust * 4.2;
      const length = 10 + windGust * 14 + Math.sin(seconds * 0.83 + phase) * 2.6;
      const tailX = anchorX - length;
      const tailY = anchorY - lift;
      const ribbonWidth = (0.65 + windFlutter * 0.75) * scale;
      particleContext.beginPath();
      particleContext.moveTo(imageX(anchorX), imageY(anchorY));
      particleContext.quadraticCurveTo(
        imageX(anchorX - length * 0.48),
        imageY(anchorY - lift * 0.2 - Math.sin(seconds * 1.4 + phase) * 1.6),
        imageX(tailX),
        imageY(tailY)
      );
      particleContext.quadraticCurveTo(
        imageX(anchorX - length * 0.45),
        imageY(anchorY - lift * 0.12 + ribbonWidth),
        imageX(anchorX),
        imageY(anchorY + ribbonWidth)
      );
      particleContext.closePath();
      particleContext.fillStyle = `rgba(154, 190, 205, ${0.075 + windGust * 0.085})`;
      particleContext.fill();
    }

    const coatRibbons = [
      [1316, 520, 1308, 748, 35, 4.4],
      [1321, 658, 1312, 742, 31, 0.1],
      [1334, 692, 1328, 754, 24, 1.7],
      [1402, 682, 1408, 746, 18, 3.2],
      [1408, 526, 1418, 744, 27, 5.6],
    ];
    particleContext.filter = `blur(${Math.max(0.7, 1.25 * scale)}px)`;
    for (const [topX, topY, hemX, hemY, reach, phase] of coatRibbons) {
      const gust = windGust * reach + Math.sin(seconds * 1.18 + phase) * 5;
      const rise = windFlutter * 7 + Math.sin(seconds * 0.94 + phase) * 3;
      const tailX = hemX - gust;
      const tailY = hemY - rise;
      const fabric = particleContext.createLinearGradient(
        imageX(topX), imageY(topY), imageX(tailX), imageY(tailY)
      );
      fabric.addColorStop(0, "rgba(109, 143, 158, 0)");
      fabric.addColorStop(0.58, `rgba(125, 158, 171, ${0.042 + windGust * 0.052})`);
      fabric.addColorStop(1, "rgba(164, 191, 201, 0)");
      particleContext.beginPath();
      particleContext.moveTo(imageX(topX), imageY(topY));
      particleContext.bezierCurveTo(
        imageX(topX - gust * 0.18), imageY(topY + 28),
        imageX(tailX + 8), imageY(tailY - 8),
        imageX(tailX), imageY(tailY)
      );
      particleContext.bezierCurveTo(
        imageX(tailX + 12), imageY(tailY + 7),
        imageX(hemX + 6), imageY(hemY + 2),
        imageX(topX + 4), imageY(topY + 5)
      );
      particleContext.closePath();
      particleContext.fillStyle = fabric;
      particleContext.fill();
    }
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    const interiorGlow = particleContext.createRadialGradient(
      imageX(242), imageY(488), 16 * scale,
      imageX(242), imageY(488), 338 * scale
    );
    interiorGlow.addColorStop(0, `rgba(255, 174, 82, ${0.035 + visualLevel * 0.125})`);
    interiorGlow.addColorStop(0.5, `rgba(255, 83, 59, ${0.024 + bassLevel * 0.078})`);
    interiorGlow.addColorStop(1, "rgba(198, 18, 42, 0)");
    particleContext.fillStyle = interiorGlow;
    particleContext.fillRect(imageX(-100), imageY(145), 700 * scale, 690 * scale);
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    particleContext.filter = `blur(${Math.max(11, (14 + visualLevel * 15) * scale)}px)`;
    const windowSectors = 42;
    for (let sector = 0; sector < windowSectors; sector += 1) {
      const ratio = sector / windowSectors;
      const angle = ratio * Math.PI * 2 - Math.PI / 2;
      const frequencyIndex = audioFrequencyData
        ? Math.min(audioFrequencyData.length - 1, 1 + Math.floor(sector / windowSectors * 43))
        : 0;
      let frequency = 0;
      if (audioFrequencyData) {
        for (let sample = -2; sample <= 2; sample += 1) {
          const sampleIndex = Math.max(0, Math.min(audioFrequencyData.length - 1, frequencyIndex + sample));
          frequency += audioFrequencyData[sampleIndex] / 255;
        }
        frequency /= 5;
      }
      const frequencyPower = Math.pow(frequency, 1.12);
      const redIntensity = Math.min(1, frequencyPower * 0.82 + visualLevel * 0.58);
      const color = {
        red: 255,
        green: Math.round(132 - redIntensity * 78),
        blue: Math.round(42 + redIntensity * 28),
      };
      const inwardPull = 1 - frequencyPower * 0.16;
      const plumeX = imageX(242 + Math.cos(angle) * 154 * inwardPull);
      const plumeY = imageY(488 + Math.sin(angle) * 202 * inwardPull);
      const plumeRadius = (28 + visualLevel * 18 + frequencyPower * 48) * scale;
      const plumeAlpha = 0.028 + visualLevel * 0.095 + frequencyPower * 0.2;
      const plume = particleContext.createRadialGradient(
        plumeX, plumeY, 0, plumeX, plumeY, plumeRadius
      );
      plume.addColorStop(0, `rgba(${color.red}, ${color.green}, ${color.blue}, ${plumeAlpha})`);
      plume.addColorStop(0.38, `rgba(${color.red}, ${color.green}, ${color.blue}, ${plumeAlpha * 0.52})`);
      plume.addColorStop(1, `rgba(${color.red}, ${color.green}, ${color.blue}, 0)`);
      particleContext.fillStyle = plume;
      particleContext.beginPath();
      particleContext.arc(plumeX, plumeY, plumeRadius, 0, Math.PI * 2);
      particleContext.fill();
    }
    particleContext.restore();

    const glassFrequency = Math.pow(getFrequencyLevel(9, 3), 0.82);
    const glassGlint = Math.min(
      1,
      0.05 + glassFrequency * 0.78 + bassLevel * 0.34 + Math.pow(0.5 + 0.5 * Math.sin(seconds * 1.7), 9) * 0.18
    );
    if (glassGlint > 0.02) {
      const glintX = imageX(260);
      const glintY = imageY(527);
      const glintRadius = (20 + glassGlint * 26) * scale;
      const glint = particleContext.createRadialGradient(glintX, glintY, 0, glintX, glintY, glintRadius);
      glint.addColorStop(0, `rgba(255, 246, 222, ${glassGlint * 0.68})`);
      glint.addColorStop(0.16, `rgba(255, 76, 74, ${glassGlint * 0.42})`);
      glint.addColorStop(0.48, `rgba(222, 22, 48, ${glassGlint * 0.2})`);
      glint.addColorStop(1, "rgba(255, 44, 68, 0)");
      particleContext.save();
      particleContext.globalCompositeOperation = "lighter";
      particleContext.filter = `blur(${Math.max(2, 4 * scale)}px)`;
      particleContext.fillStyle = glint;
      particleContext.fillRect(glintX - glintRadius, glintY - glintRadius, glintRadius * 2, glintRadius * 2);
      particleContext.restore();
    }

    const ripplePoints = [
      [155, 825, 0.08, 1], [330, 758, 0.36, 1], [520, 875, 0.72, 1],
      [705, 795, 0.2, 0], [930, 844, 0.56, 0], [1150, 780, 0.88, 0],
      [1260, 902, 0.43, 0],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.lineWidth = Math.max(0.42, scale * 0.68);
    for (const [x, y, phase, warm] of ripplePoints) {
      const cycle = (phase + seconds * 0.18) % 1;
      const radius = (2 + cycle * 30) * scale;
      const fade = Math.pow(Math.sin(cycle * Math.PI), 1.5);
      particleContext.beginPath();
      particleContext.ellipse(
        imageX(x), imageY(y), radius, radius * (0.12 + y / IMAGE_HEIGHT * 0.08), -0.02, 0, Math.PI * 2
      );
      particleContext.strokeStyle = warm
        ? `rgba(255, 176, 96, ${fade * 0.16})`
        : `rgba(121, 194, 228, ${fade * 0.14})`;
      particleContext.stroke();
    }
    particleContext.restore();

    const reflectionStreaks = [
      [112, 714, 848, 34, 1], [226, 713, 900, 25, 1], [438, 711, 842, 20, 1],
      [850, 701, 887, 18, 0], [1030, 686, 875, 14, 0], [1220, 678, 835, 12, 0],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.filter = `blur(${Math.max(1, 2.4 * scale)}px)`;
    for (const [x, top, bottom, streakWidth, warm] of reflectionStreaks) {
      const shimmer = 0.5 + 0.5 * Math.sin(seconds * (0.72 + x * 0.0008) + x * 0.03);
      const gradient = particleContext.createLinearGradient(imageX(x), imageY(top), imageX(x), imageY(bottom));
      gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      gradient.addColorStop(0.3, warm
        ? `rgba(255, 170, 83, ${0.018 + shimmer * 0.05})`
        : `rgba(111, 190, 230, ${0.014 + shimmer * 0.045})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      particleContext.fillStyle = gradient;
      particleContext.fillRect(imageX(x) - streakWidth * scale * 0.5, imageY(top), streakWidth * scale, (bottom - top) * scale);
    }
    particleContext.restore();

    const roadLights = [
      [1565, 898, 1492, 610, 0.12],
      [1600, 914, 1530, 622, 0.48],
      [1528, 870, 1465, 628, 0.77],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    for (let pathIndex = 0; pathIndex < roadLights.length; pathIndex += 1) {
      const [startX, startY, endX, endY, phase] = roadLights[pathIndex];
      for (let light = 0; light < 7; light += 1) {
        const travel = (phase + light / 7 + seconds * 0.065) % 1;
        const x = startX + (endX - startX) * travel;
        const y = startY + (endY - startY) * travel;
        const isRed = light % 3 === 0;
        const roadFrequency = Math.pow(getFrequencyLevel(3 + ((pathIndex * 9 + light * 4) % 38), 2), 0.9);
        const roadPulse = Math.min(1, roadFrequency * 0.82 + (isRed ? bassLevel * 0.62 : visualLevel * 0.2));
        const radius = (0.6 + travel * 1.5 + roadPulse * 2.6) * scale;
        if (roadPulse > 0.12) {
          const haloRadius = radius * (2.6 + roadPulse * 2.2);
          const halo = particleContext.createRadialGradient(imageX(x), imageY(y), 0, imageX(x), imageY(y), haloRadius);
          halo.addColorStop(0, isRed
            ? `rgba(255, 36, 62, ${roadPulse * 0.28})`
            : `rgba(82, 205, 255, ${roadPulse * 0.18})`);
          halo.addColorStop(1, "rgba(0, 0, 0, 0)");
          particleContext.fillStyle = halo;
          particleContext.fillRect(imageX(x) - haloRadius, imageY(y) - haloRadius, haloRadius * 2, haloRadius * 2);
        }
        particleContext.beginPath();
        particleContext.fillStyle = isRed
          ? `rgba(255, 56, 76, ${0.13 + travel * 0.26 + roadPulse * 0.52})`
          : `rgba(101, 215, 255, ${0.09 + travel * 0.24 + roadPulse * 0.35})`;
        particleContext.arc(imageX(x), imageY(y), radius, 0, Math.PI * 2);
        particleContext.fill();
      }
    }
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    for (const debris of sceneTwoDebris) {
      const cycle = (debris.phase + seconds * debris.speed) % 1;
      const rotorPull = Math.sin(cycle * Math.PI);
      const x = debris.x + Math.sin(cycle * Math.PI * 2 + debris.phase * 9) * debris.drift;
      const y = debris.y - rotorPull * debris.lift;
      const rotation = seconds * debris.spin + debris.phase * Math.PI * 2;
      particleContext.save();
      particleContext.translate(imageX(x), imageY(y));
      particleContext.rotate(rotation);
      particleContext.fillStyle = debris.warmth > 0.72
        ? `rgba(255, 188, 112, ${debris.alpha * rotorPull})`
        : `rgba(178, 202, 212, ${debris.alpha * rotorPull})`;
      particleContext.fillRect(-debris.size * scale, -debris.size * 0.32 * scale, debris.size * 2 * scale, debris.size * 0.64 * scale);
      particleContext.restore();
    }
    particleContext.restore();

    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    for (const light of sceneTwoBuildingLights) {
      const wave = 0.5 + 0.5 * Math.sin(seconds * light.speed + light.phase);
      const frequency = Math.pow(getFrequencyLevel(light.frequencyIndex, 2), 1.04);
      const illumination = Math.min(1, 0.08 + Math.pow(wave, 3.2) * 0.14 + frequency * 0.76 + bassLevel * 0.12);
      const lightX = imageX(light.x);
      const lightY = imageY(light.y);
      const lightColor = light.warmth > 0.68
        ? [255, 178, 92]
        : light.warmth < 0.16
          ? [255, 91, 118]
          : [117, 216, 255];
      particleContext.beginPath();
      particleContext.fillStyle = `rgba(${lightColor[0]}, ${lightColor[1]}, ${lightColor[2]}, ${0.025 + illumination * 0.48})`;
      particleContext.arc(lightX, lightY, light.size * (0.55 + illumination * 1.45) * scale, 0, Math.PI * 2);
      particleContext.fill();
      if (illumination > 0.42) {
        const haloRadius = light.size * (3.2 + illumination * 4.6) * scale;
        const halo = particleContext.createRadialGradient(lightX, lightY, 0, lightX, lightY, haloRadius);
        halo.addColorStop(0, `rgba(${lightColor[0]}, ${lightColor[1]}, ${lightColor[2]}, ${illumination * 0.16})`);
        halo.addColorStop(1, `rgba(${lightColor[0]}, ${lightColor[1]}, ${lightColor[2]}, 0)`);
        particleContext.fillStyle = halo;
        particleContext.fillRect(lightX - haloRadius, lightY - haloRadius, haloRadius * 2, haloRadius * 2);
      }
    }
    particleContext.restore();

    const reactiveRedLights = [
      [701, 647, 2, 1.35], [869, 680, 4, 1.7],
      [692, 393, 7, 0.48], [805, 409, 12, 0.42], [954, 432, 17, 0.4],
      [1252, 444, 23, 0.42], [1496, 469, 29, 0.48], [1592, 476, 34, 0.48],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    particleContext.filter = `blur(${Math.max(1.4, 2.2 * scale)}px)`;
    for (const [x, y, frequencyIndex, emphasis] of reactiveRedLights) {
      const frequency = Math.pow(getFrequencyLevel(frequencyIndex, 2), 0.78);
      const pulse = Math.min(1, frequency * 0.82 + bassLevel * 0.52);
      const radius = (3.4 + pulse * 15 * emphasis) * scale;
      const beacon = particleContext.createRadialGradient(imageX(x), imageY(y), 0, imageX(x), imageY(y), radius);
      beacon.addColorStop(0, `rgba(255, 232, 203, ${0.24 + pulse * 0.62})`);
      beacon.addColorStop(0.12, `rgba(255, 38, 56, ${0.18 + pulse * 0.54})`);
      beacon.addColorStop(0.48, `rgba(220, 12, 42, ${pulse * 0.2})`);
      beacon.addColorStop(1, "rgba(190, 0, 36, 0)");
      particleContext.fillStyle = beacon;
      particleContext.fillRect(imageX(x) - radius, imageY(y) - radius, radius * 2, radius * 2);
    }
    particleContext.restore();

    const cityLights = [
      [645, 520, 0.2], [730, 505, 1.1], [810, 548, 2.4], [905, 518, 3.2],
      [1120, 532, 4.3], [1208, 498, 5.2], [1450, 542, 6.1], [1570, 510, 7.4],
    ];
    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    for (let cityIndex = 0; cityIndex < cityLights.length; cityIndex += 1) {
      const [x, y, phase] = cityLights[cityIndex];
      const twinkle = Math.pow(0.5 + 0.5 * Math.sin(seconds * 1.28 + phase), 5);
      const frequency = Math.pow(getFrequencyLevel(8 + cityIndex * 4, 2), 0.95);
      const cityPulse = Math.min(1, frequency * 0.88 + twinkle * 0.22);
      const lightRadius = (0.7 + cityPulse * 3.1) * scale;
      particleContext.beginPath();
      particleContext.fillStyle = `rgba(192, 230, 241, ${0.05 + cityPulse * 0.52})`;
      particleContext.arc(imageX(x), imageY(y), lightRadius, 0, Math.PI * 2);
      particleContext.fill();
    }
    particleContext.restore();

    if (bassLevel > 0.02) {
      const bassColor = getReactiveColor(Math.min(1, visualLevel * 0.82 + bassLevel * 0.52));
      particleContext.save();
      particleContext.globalCompositeOperation = "screen";
      particleContext.fillStyle = `rgba(${bassColor.red}, ${bassColor.green}, ${bassColor.blue}, ${bassLevel * 0.028})`;
      particleContext.fillRect(0, 0, width, height);
      particleContext.restore();
    }

    if (cameraFlashStrength > 0.002) {
      const flashRadius = Math.max(width, height) * 0.78;
      const cameraBloom = particleContext.createRadialGradient(
        helicopterX, helicopterY, 0,
        helicopterX, helicopterY, flashRadius
      );
      cameraBloom.addColorStop(0, `rgba(244, 252, 255, ${cameraFlashStrength * 0.98})`);
      cameraBloom.addColorStop(0.045, `rgba(216, 241, 255, ${cameraFlashStrength * 0.72})`);
      cameraBloom.addColorStop(0.23, `rgba(151, 211, 244, ${cameraFlashStrength * 0.24})`);
      cameraBloom.addColorStop(1, "rgba(80, 142, 190, 0)");
      particleContext.save();
      particleContext.globalCompositeOperation = "screen";
      particleContext.fillStyle = cameraBloom;
      particleContext.fillRect(0, 0, width, height);
      particleContext.fillStyle = `rgba(213, 239, 255, ${cameraFlashStrength * 0.16})`;
      particleContext.fillRect(0, 0, width, height);
      const flare = particleContext.createLinearGradient(0, helicopterY, width, helicopterY);
      flare.addColorStop(0, "rgba(164, 218, 250, 0)");
      flare.addColorStop(0.5, `rgba(232, 248, 255, ${cameraFlashStrength * 0.22})`);
      flare.addColorStop(1, "rgba(164, 218, 250, 0)");
      particleContext.fillStyle = flare;
      particleContext.fillRect(0, helicopterY - 2 * scale, width, 4 * scale);
      particleContext.restore();
    }
  }

  function formatTrackTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  }

  function getPreviewStart() {
    return activeTrack.previewStart ?? 0;
  }

  function getPreviewEnd() {
    const duration = soundtrack.duration;
    const configuredEnd = activeTrack.previewEnd ?? PREVIEW_SECONDS;
    if (!Number.isFinite(duration) || duration <= 0) return configuredEnd;
    return Math.min(duration, configuredEnd);
  }

  function getPreviewDuration() {
    return Math.max(0.001, getPreviewEnd() - getPreviewStart());
  }

  function enforcePreviewLimit() {
    const previewStart = getPreviewStart();
    const previewEnd = getPreviewEnd();
    if (soundtrack.currentTime < previewStart) {
      soundtrack.currentTime = previewStart;
      updateTrackTimeline();
      return;
    }
    if (soundtrack.currentTime < previewEnd) return;
    soundtrack.currentTime = previewStart;
    trackSeek.value = "0";
    if (!soundtrack.paused) soundtrack.play().catch(() => {});
    updateTrackTimeline();
  }

  function updateTrackTimeline() {
    const previewStart = getPreviewStart();
    const previewEnd = getPreviewEnd();
    const duration = getPreviewDuration();
    const seekRatio = Number(trackSeek.value) / Number(trackSeek.max);
    const displayedTime = isSeeking
      ? previewStart + seekRatio * duration
      : Math.min(previewEnd, Math.max(previewStart, soundtrack.currentTime));
    const progress = Math.min(1, Math.max(0, (displayedTime - previewStart) / duration));

    if (!isSeeking) trackSeek.value = String(Math.round(progress * Number(trackSeek.max)));
    trackSeek.style.setProperty("--seek-progress", `${(progress * 100).toFixed(3)}%`);
    trackSeek.setAttribute(
      "aria-valuetext",
      `${formatTrackTime(displayedTime)} de ${formatTrackTime(previewEnd)}`
    );
    trackCurrent.value = formatTrackTime(displayedTime);
    trackDuration.value = formatTrackTime(previewEnd);
  }

  function handleSeekInput(event) {
    const previewStart = getPreviewStart();
    const duration = getPreviewDuration();
    const progress = Number(event.currentTarget.value) / Number(event.currentTarget.max);
    soundtrack.currentTime = previewStart + progress * duration;
    updateTrackTimeline();
  }

  function handleSeekStart() {
    isSeeking = true;
  }

  function handleSeekEnd() {
    isSeeking = false;
    updateTrackTimeline();
  }

  function handleSoundtrackMetadata() {
    const previewStart = getPreviewStart();
    const previewEnd = getPreviewEnd();
    if (soundtrack.currentTime < previewStart || soundtrack.currentTime >= previewEnd) {
      soundtrack.currentTime = previewStart;
    }
    updateTrackTimeline();
  }

  function render(gl, now) {
    const seconds = getElapsedSeconds(now);
    const progress = (seconds % LOOP_SECONDS) / LOOP_SECONDS;
    const explosionProgress = (seconds % EXPLOSION_SECONDS) / EXPLOSION_SECONDS;
    gl.useProgram(glProgram);
    gl.uniform1f(uniforms.time, seconds);
    gl.uniform1f(uniforms.progress, progress);
    gl.uniform1f(uniforms.explosionProgress, explosionProgress);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    updateAudioAnalysis();
    if (activeTrack.id === 1) {
      drawParticles(seconds);
      drawBassFlash(seconds);
      drawPortalEqualizer(seconds);
    } else {
      drawStationScene(seconds);
    }
    enforcePreviewLimit();
    updateTrackTimeline();
    animationFrame = requestAnimationFrame((nextNow) => render(gl, nextNow));
  }

  function closeLibrary() {
    recordLibrary.classList.add("is-hidden");
    recordLibrary.setAttribute("aria-hidden", "true");
    recordLibrary.inert = true;
    scene.classList.remove("library-open");
    window.setTimeout(() => collectionTrigger.focus({ preventScroll: true }), 650);
  }

  function openLibrary() {
    soundtrack.pause();
    recordLibrary.inert = false;
    recordLibrary.removeAttribute("aria-hidden");
    recordLibrary.classList.remove("is-hidden");
    scene.classList.add("library-open");
    const currentChoice = recordChoices.find(
      (choice) => Number(choice.dataset.trackId) === activeTrack.id
    );
    window.setTimeout(() => currentChoice?.focus({ preventScroll: true }), 80);
  }

  function selectTrack(trackId) {
    const selectedTrack = TRACKS.find((track) => track.id === trackId);
    if (!selectedTrack) return;

    soundtrack.pause();
    soundtrack.currentTime = 0;
    activeTrack = selectedTrack;
    hasEnteredScene = true;
    scene.dataset.track = String(selectedTrack.id);
    scene.classList.toggle("scene--track-1", selectedTrack.id === 1);
    scene.classList.toggle("scene--track-2", selectedTrack.id === 2);
    scene.setAttribute("aria-label", selectedTrack.sceneLabel);
    trackTitle.textContent = selectedTrack.title;
    trackArtist.textContent = selectedTrack.artist;
    trackButton.setAttribute(
      "aria-label",
      `Reproducir la canción y alternar pantalla completa. Listening to: ${selectedTrack.title} — ${selectedTrack.artist}`
    );
    soundtrack.src = selectedTrack.audio;
    soundtrack.load();
    trackSeek.value = "0";
    trackSeek.style.setProperty("--seek-progress", "0%");
    trackCurrent.value = formatTrackTime(selectedTrack.previewStart);
    trackDuration.value = formatTrackTime(selectedTrack.previewEnd);
    startTime = performance.now();
    document.title = `${selectedTrack.title} — ${selectedTrack.artist}`;
    window.history.replaceState(null, "", `?track=${selectedTrack.id}`);
    closeLibrary();
    playPreview();
  }

  function handleDocumentKeydown(event) {
    if (event.key !== "Escape") return;
    if (recordLibrary.classList.contains("is-hidden")) {
      openLibrary();
    } else if (hasEnteredScene) {
      closeLibrary();
    }
  }

  async function handleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  function playPreview() {
    const previewStart = getPreviewStart();
    const previewEnd = getPreviewEnd();
    if (soundtrack.currentTime < previewStart || soundtrack.currentTime >= previewEnd) {
      soundtrack.currentTime = previewStart;
    }
    initializeAudioAnalysis();
    if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
    const isFirstStart = soundtrack.currentTime < 0.05;
    soundtrack.play().then(() => {
      if (isFirstStart) startTime = performance.now();
    }).catch(() => {
      scene.classList.remove("is-playing");
    });
  }

  function handleTrackClick() {
    if (soundtrack.paused) playPreview();

    handleFullscreen().catch(() => {});
  }

  function handlePreviewPlayback() {
    if (soundtrack.paused) playPreview();
    else soundtrack.pause();
  }

  function handleSoundtrackPlaying() {
    scene.classList.add("is-playing");
    previewPlayback.setAttribute("aria-label", "Pausar preview");
    previewPlayback.setAttribute("aria-pressed", "true");
  }

  function handleSoundtrackPause() {
    scene.classList.remove("is-playing");
    previewPlayback.setAttribute("aria-label", "Reproducir preview");
    previewPlayback.setAttribute("aria-pressed", "false");
  }

  function handleFullscreenChange() {
    trackButton.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  }

  function initialize() {
    const image = new Image();
    image.addEventListener("load", () => {
      try {
        const gl = initializeWebGL(image);
        resize(gl);
        window.addEventListener("resize", () => resize(gl));
        trackButton.addEventListener("click", handleTrackClick);
        previewPlayback.addEventListener("click", handlePreviewPlayback);
        soundtrack.addEventListener("playing", handleSoundtrackPlaying);
        soundtrack.addEventListener("pause", handleSoundtrackPause);
        soundtrack.addEventListener("loadedmetadata", handleSoundtrackMetadata);
        soundtrack.addEventListener("durationchange", updateTrackTimeline);
        soundtrack.addEventListener("timeupdate", enforcePreviewLimit);
        trackSeek.addEventListener("input", handleSeekInput);
        trackSeek.addEventListener("pointerdown", handleSeekStart);
        trackSeek.addEventListener("pointerup", handleSeekEnd);
        trackSeek.addEventListener("pointercancel", handleSeekEnd);
        trackSeek.addEventListener("change", handleSeekEnd);
        recordChoices.forEach((choice) => {
          choice.addEventListener("click", () => selectTrack(Number(choice.dataset.trackId)));
        });
        collectionTrigger.addEventListener("click", openLibrary);
        document.addEventListener("keydown", handleDocumentKeydown);
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        window.addEventListener("beforeunload", () => cancelAnimationFrame(animationFrame));
        scene.classList.add("library-open");
        loadState.classList.add("is-ready");
        loadState.setAttribute("aria-hidden", "true");
        window.setTimeout(() => {
          loadState.hidden = true;
        }, 950);
        animationFrame = requestAnimationFrame((now) => render(gl, now));
      } catch (error) {
        loadState.textContent = `No se pudo iniciar la animación: ${error.message}`;
      }
    });
    image.addEventListener("error", () => {
      loadState.textContent = "No se encontró Imagen1.png junto al HTML.";
    });
    image.src = "Imagen1.png";
  }

  initialize();
})();
