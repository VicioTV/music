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
      sceneLabel: "Escena del portal",
    },
    {
      id: 2,
      title: "Perfume and Wine 壊さないで",
      artist: "Creador100k",
      image: "Imagen2.png",
      audio: "Imagen2.mp3",
      sceneLabel: "Escena de la estación nocturna",
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
    const density = Math.min(260, Math.round(window.innerWidth / 5));
    sceneTwoRain = Array.from({ length: density }, () => ({
      x: Math.random(),
      y: Math.random(),
      depth: Math.pow(Math.random(), 1.35),
      speed: randomBetween(0.055, 0.14),
      length: randomBetween(7, 25),
      alpha: randomBetween(0.08, 0.32),
      drift: randomBetween(-0.012, 0.004),
    }));
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
    const clockX = offsetX + 892 * scale;
    const clockY = offsetY + 329 * scale;
    const clockRadius = 139 * scale;
    const visualLevel = Math.min(1, Math.pow(audioEnergy * 0.82 + audioPeak * 0.55, 0.78) * 1.3);
    const bassLevel = Math.min(1, audioBass * 1.28 + audioBassFlash * 0.9);
    const breath = 0.5 + 0.5 * Math.sin(seconds * 0.52);

    particleContext.clearRect(0, 0, width, height);

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.lineCap = "round";
    for (const drop of sceneTwoRain) {
      const travel = (drop.y + seconds * drop.speed) % 1.08;
      const x = (drop.x + seconds * drop.drift) % 1.06 * width;
      const y = travel * height;
      const length = drop.length * (0.62 + drop.depth * 1.2) * scale;
      particleContext.beginPath();
      particleContext.moveTo(x, y);
      particleContext.lineTo(x - length * 0.12, y + length);
      particleContext.strokeStyle = `rgba(184, 211, 225, ${drop.alpha * (0.34 + drop.depth * 0.5)})`;
      particleContext.lineWidth = Math.max(0.35, 0.42 + drop.depth * 0.58);
      particleContext.stroke();
    }
    particleContext.restore();

    const ringPoints = 128;
    const traceClockSignal = (extraScale = 1) => {
      particleContext.beginPath();
      for (let index = 0; index <= ringPoints; index += 1) {
        const ratio = index / ringPoints;
        const angle = ratio * Math.PI * 2 - Math.PI / 2;
        const frequencyIndex = audioFrequencyData
          ? Math.min(audioFrequencyData.length - 1, Math.floor(ratio * 42) + 1)
          : 0;
        const previousIndex = Math.max(0, frequencyIndex - 1);
        const nextIndex = audioFrequencyData
          ? Math.min(audioFrequencyData.length - 1, frequencyIndex + 1)
          : 0;
        const frequency = audioFrequencyData
          ? (audioFrequencyData[previousIndex] + audioFrequencyData[frequencyIndex] * 2 + audioFrequencyData[nextIndex]) / (4 * 255)
          : 0;
        const signal = Math.pow(frequency, 1.55) * (7 + visualLevel * 24) * scale * extraScale;
        const ambient = (1.2 + breath * 1.4) * scale;
        const radius = clockRadius + ambient + signal;
        const x = clockX + Math.cos(angle) * radius;
        const y = clockY + Math.sin(angle) * radius;
        if (index === 0) particleContext.moveTo(x, y);
        else particleContext.lineTo(x, y);
      }
      particleContext.closePath();
    };

    particleContext.save();
    particleContext.globalCompositeOperation = "screen";
    particleContext.lineJoin = "round";
    particleContext.lineCap = "round";
    particleContext.filter = `blur(${Math.max(5, scale * (8 + visualLevel * 10))}px)`;
    particleContext.strokeStyle = `rgba(112, 180, 220, ${0.1 + visualLevel * 0.28})`;
    particleContext.lineWidth = Math.max(4, scale * (8 + visualLevel * 9));
    traceClockSignal(1.16);
    particleContext.stroke();
    particleContext.filter = "none";
    particleContext.strokeStyle = `rgba(235, 215, 177, ${0.34 + visualLevel * 0.54})`;
    particleContext.lineWidth = Math.max(0.8, scale * (1.15 + visualLevel * 1.65));
    traceClockSignal(1);
    particleContext.stroke();
    particleContext.restore();

    if (bassLevel > 0.08) {
      particleContext.save();
      particleContext.globalCompositeOperation = "screen";
      particleContext.lineCap = "round";
      for (let wave = 0; wave < 3; wave += 1) {
        const waveAlpha = Math.max(0, bassLevel - wave * 0.13) * (0.18 - wave * 0.035);
        const spread = (wave + 1) * 12 * scale;
        particleContext.beginPath();
        particleContext.moveTo(clockX - 22 * scale, clockY + clockRadius * 0.92);
        particleContext.bezierCurveTo(
          offsetX + 970 * scale - spread,
          offsetY + 560 * scale,
          offsetX + 1090 * scale + spread,
          offsetY + 785 * scale,
          offsetX + 1210 * scale + spread * 1.8,
          offsetY + 940 * scale
        );
        particleContext.strokeStyle = `rgba(104, 176, 219, ${waveAlpha})`;
        particleContext.lineWidth = Math.max(0.7, scale * (1.4 + bassLevel * 2.2));
        particleContext.stroke();
      }
      particleContext.restore();
    }

    const stormPhase = seconds % 17;
    const distantFlicker = stormPhase > 11.2 && stormPhase < 11.55
      ? Math.sin((stormPhase - 11.2) / 0.35 * Math.PI) * 0.26
      : 0;
    const lightning = Math.min(0.42, distantFlicker + audioBassFlash * 0.16);
    if (lightning > 0.005) {
      const strikeX = offsetX + 1518 * scale;
      const strikeY = offsetY + 242 * scale;
      const glow = particleContext.createRadialGradient(
        strikeX,
        strikeY,
        0,
        strikeX,
        strikeY,
        260 * scale
      );
      glow.addColorStop(0, `rgba(174, 218, 255, ${lightning})`);
      glow.addColorStop(0.35, `rgba(102, 158, 207, ${lightning * 0.34})`);
      glow.addColorStop(1, "rgba(64, 105, 153, 0)");
      particleContext.save();
      particleContext.globalCompositeOperation = "screen";
      particleContext.fillStyle = glow;
      particleContext.fillRect(0, 0, width, height);
      particleContext.fillStyle = `rgba(110, 170, 218, ${lightning * 0.035})`;
      particleContext.fillRect(0, 0, width, height);
      particleContext.restore();
    }
  }

  function formatTrackTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  }

  function getPreviewDuration() {
    const duration = soundtrack.duration;
    if (!Number.isFinite(duration) || duration <= 0) return PREVIEW_SECONDS;
    return Math.min(duration, PREVIEW_SECONDS);
  }

  function enforcePreviewLimit() {
    const previewDuration = getPreviewDuration();
    if (soundtrack.currentTime < previewDuration) return;
    soundtrack.currentTime = 0;
    trackSeek.value = "0";
    if (!soundtrack.paused) soundtrack.play().catch(() => {});
    updateTrackTimeline();
  }

  function updateTrackTimeline() {
    const duration = getPreviewDuration();
    const seekRatio = Number(trackSeek.value) / Number(trackSeek.max);
    const displayedTime = isSeeking ? seekRatio * duration : soundtrack.currentTime;
    const progress = Math.min(1, Math.max(0, displayedTime / duration));

    if (!isSeeking) trackSeek.value = String(Math.round(progress * Number(trackSeek.max)));
    trackSeek.style.setProperty("--seek-progress", `${(progress * 100).toFixed(3)}%`);
    trackSeek.setAttribute(
      "aria-valuetext",
      `${formatTrackTime(displayedTime)} de ${formatTrackTime(duration)}`
    );
    trackCurrent.value = formatTrackTime(displayedTime);
    trackDuration.value = formatTrackTime(duration);
  }

  function handleSeekInput(event) {
    const duration = getPreviewDuration();
    const progress = Number(event.currentTarget.value) / Number(event.currentTarget.max);
    soundtrack.currentTime = progress * duration;
    updateTrackTimeline();
  }

  function handleSeekStart() {
    isSeeking = true;
  }

  function handleSeekEnd() {
    isSeeking = false;
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
    trackCurrent.value = "0:00";
    trackDuration.value = "1:40";
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
    if (soundtrack.currentTime >= getPreviewDuration()) soundtrack.currentTime = 0;
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
        soundtrack.addEventListener("loadedmetadata", updateTrackTimeline);
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
