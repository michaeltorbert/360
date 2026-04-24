const API_IMAGES_URL = "/api/images";
const MANIFEST_URL = "images/manifest.json";
const MAX_PITCH = Math.PI / 2 - 0.04;
const MIN_FOV = 34;
const MAX_FOV = 100;
const ROTATION_SPEED = 0.0042;
const ZOOM_SPEED = 0.045;

const elements = {
  canvas: document.querySelector("#viewer"),
  gallery: document.querySelector("#gallery"),
  imageTitle: document.querySelector("#image-title"),
  imageCount: document.querySelector("#image-count"),
  status: document.querySelector("#status"),
  previous: document.querySelector("#previous-image"),
  next: document.querySelector("#next-image"),
  refresh: document.querySelector("#refresh-images"),
  reset: document.querySelector("#reset-view")
};

const state = {
  images: [],
  currentIndex: 0,
  yaw: 0,
  pitch: 0,
  fov: 78,
  textureReady: false,
  renderQueued: false,
  activePointers: new Map(),
  lastPinchDistance: null,
  loadToken: 0
};

const renderer = createRenderer(elements.canvas);

init().catch((error) => {
  console.error(error);
  setStatus(error.message || "The 360 viewer could not start.");
});

async function init() {
  bindControls();
  const images = await loadImageList();

  if (images.length === 0) {
    setStatus("No supported images were found in the images folder.");
    setTitle("No panoramas found");
    return;
  }

  state.images = images;
  state.currentIndex = 0;
  renderGallery();
  updateImageCount();
  await showImage(0);
}

async function loadImageList() {
  const sources = [
    () => fetchJson(API_IMAGES_URL),
    () => fetchJson(MANIFEST_URL)
  ];

  for (const load of sources) {
    try {
      const data = await load();
      const images = normalizeImageList(data);
      if (images.length > 0) {
        return images;
      }
    } catch (error) {
      console.info("Image list source unavailable:", error.message);
    }
  }

  return [];
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }

  return response.json();
}

function normalizeImageList(data) {
  const rawImages = Array.isArray(data) ? data : data?.images;

  if (!Array.isArray(rawImages)) {
    return [];
  }

  return rawImages
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          src: entry,
          title: titleFromPath(entry)
        };
      }

      if (!entry?.src) {
        return null;
      }

      return {
        src: entry.src,
        title: entry.title || titleFromPath(entry.src)
      };
    })
    .filter(Boolean);
}

async function showImage(index) {
  const image = state.images[index];

  if (!image) {
    return;
  }

  state.currentIndex = index;
  state.textureReady = false;
  state.loadToken += 1;

  const loadToken = state.loadToken;
  setTitle(image.title);
  setStatus(`Loading ${image.title}...`);
  updateControls();
  updateGalleryCurrent();

  const bitmap = await loadBitmap(image.src);

  if (loadToken !== state.loadToken) {
    return;
  }

  renderer.setTexture(bitmap);
  state.textureReady = true;
  setStatus("");
  queueRender();
}

function loadBitmap(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));
    image.src = src;
  });
}

function createRenderer(canvas) {
  const gl =
    canvas.getContext("webgl", { antialias: false, depth: false, stencil: false }) ||
    canvas.getContext("experimental-webgl", { antialias: false, depth: false, stencil: false });

  if (!gl) {
    throw new Error("WebGL is not available in this browser.");
  }

  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 aPosition;
      varying vec2 vPosition;

      void main() {
        vPosition = aPosition;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `
  );

  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision highp float;

      uniform sampler2D uTexture;
      uniform float uYaw;
      uniform float uPitch;
      uniform float uAspect;
      uniform float uTanHalfFov;
      varying vec2 vPosition;

      const float PI = 3.141592653589793;

      void main() {
        vec3 direction = normalize(vec3(
          vPosition.x * uAspect * uTanHalfFov,
          vPosition.y * uTanHalfFov,
          -1.0
        ));

        float pitchCos = cos(uPitch);
        float pitchSin = sin(uPitch);
        direction = vec3(
          direction.x,
          direction.y * pitchCos - direction.z * pitchSin,
          direction.y * pitchSin + direction.z * pitchCos
        );

        float yawCos = cos(uYaw);
        float yawSin = sin(uYaw);
        direction = vec3(
          direction.x * yawCos + direction.z * yawSin,
          direction.y,
          -direction.x * yawSin + direction.z * yawCos
        );

        float longitude = atan(direction.x, -direction.z);
        float latitude = asin(clamp(direction.y, -1.0, 1.0));
        vec2 uv = vec2(longitude / (2.0 * PI) + 0.5, 0.5 - latitude / PI);

        gl_FragColor = texture2D(uTexture, uv);
      }
    `
  );

  const program = createProgram(gl, vertexShader, fragmentShader);
  const position = gl.getAttribLocation(program, "aPosition");
  const uniforms = {
    yaw: gl.getUniformLocation(program, "uYaw"),
    pitch: gl.getUniformLocation(program, "uPitch"),
    aspect: gl.getUniformLocation(program, "uAspect"),
    tanHalfFov: gl.getUniformLocation(program, "uTanHalfFov"),
    texture: gl.getUniformLocation(program, "uTexture")
  };

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    setTexture(image) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    },
    render() {
      resizeCanvasToDisplaySize(canvas, gl);

      gl.clearColor(0.02, 0.09, 0.13, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.texture, 0);
      gl.uniform1f(uniforms.yaw, state.yaw);
      gl.uniform1f(uniforms.pitch, state.pitch);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.uniform1f(uniforms.tanHalfFov, Math.tan(toRadians(state.fov) / 2));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }

  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader link failed: ${log}`);
  }

  return program;
}

function bindControls() {
  elements.canvas.addEventListener("pointerdown", handlePointerDown);
  elements.canvas.addEventListener("pointermove", handlePointerMove);
  elements.canvas.addEventListener("pointerup", handlePointerEnd);
  elements.canvas.addEventListener("pointercancel", handlePointerEnd);
  elements.canvas.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("resize", queueRender);
  window.addEventListener("keydown", handleKeydown);

  elements.previous.addEventListener("click", () => showRelativeImage(-1));
  elements.next.addEventListener("click", () => showRelativeImage(1));
  elements.refresh.addEventListener("click", () => refreshImages().catch((error) => setStatus(error.message)));
  elements.reset.addEventListener("click", resetView);
}

function handlePointerDown(event) {
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-dragging");
  state.activePointers.set(event.pointerId, pointerFromEvent(event));
  state.lastPinchDistance = getPinchDistance();
}

function handlePointerMove(event) {
  const previous = state.activePointers.get(event.pointerId);

  if (!previous) {
    return;
  }

  const current = pointerFromEvent(event);
  state.activePointers.set(event.pointerId, current);

  if (state.activePointers.size === 1) {
    state.yaw -= (current.x - previous.x) * ROTATION_SPEED;
    state.pitch = clamp(state.pitch + (current.y - previous.y) * ROTATION_SPEED, -MAX_PITCH, MAX_PITCH);
  } else {
    const nextDistance = getPinchDistance();

    if (state.lastPinchDistance && nextDistance) {
      state.fov = clamp(state.fov - (nextDistance - state.lastPinchDistance) * 0.08, MIN_FOV, MAX_FOV);
    }

    state.lastPinchDistance = nextDistance;
  }

  queueRender();
}

function handlePointerEnd(event) {
  state.activePointers.delete(event.pointerId);
  state.lastPinchDistance = getPinchDistance();

  if (state.activePointers.size === 0) {
    elements.canvas.classList.remove("is-dragging");
  }
}

function handleWheel(event) {
  event.preventDefault();
  state.fov = clamp(state.fov + event.deltaY * ZOOM_SPEED, MIN_FOV, MAX_FOV);
  queueRender();
}

function handleKeydown(event) {
  const keyActions = {
    ArrowLeft: () => {
      state.yaw += 0.12;
    },
    ArrowRight: () => {
      state.yaw -= 0.12;
    },
    ArrowUp: () => {
      state.pitch = clamp(state.pitch + 0.1, -MAX_PITCH, MAX_PITCH);
    },
    ArrowDown: () => {
      state.pitch = clamp(state.pitch - 0.1, -MAX_PITCH, MAX_PITCH);
    },
    "+": () => {
      state.fov = clamp(state.fov - 4, MIN_FOV, MAX_FOV);
    },
    "=": () => {
      state.fov = clamp(state.fov - 4, MIN_FOV, MAX_FOV);
    },
    "-": () => {
      state.fov = clamp(state.fov + 4, MIN_FOV, MAX_FOV);
    },
    Escape: resetView
  };

  const action = keyActions[event.key];

  if (!action) {
    return;
  }

  event.preventDefault();
  action();
  queueRender();
}

function showRelativeImage(offset) {
  if (state.images.length === 0) {
    return;
  }

  const nextIndex = (state.currentIndex + offset + state.images.length) % state.images.length;
  showImage(nextIndex).catch((error) => setStatus(error.message));
}

async function refreshImages() {
  const currentSrc = state.images[state.currentIndex]?.src;
  const images = await loadImageList();

  if (images.length === 0) {
    state.images = [];
    state.currentIndex = 0;
    state.textureReady = false;
    renderGallery();
    updateImageCount();
    updateControls();
    setTitle("No panoramas found");
    setStatus("No supported images were found in the images folder.");
    return;
  }

  const nextIndex = Math.max(0, images.findIndex((image) => image.src === currentSrc));
  state.images = images;
  renderGallery();
  updateImageCount();
  updateControls();
  await showImage(nextIndex);
}

function resetView() {
  state.yaw = 0;
  state.pitch = 0;
  state.fov = 78;
  queueRender();
}

function renderGallery() {
  elements.gallery.replaceChildren(
    ...state.images.map((image, index) => {
      const button = document.createElement("button");
      const thumbnail = document.createElement("img");
      const label = document.createElement("span");

      button.type = "button";
      button.className = "gallery-button";
      button.setAttribute("aria-label", `View ${image.title}`);
      button.addEventListener("click", () => showImage(index).catch((error) => setStatus(error.message)));

      thumbnail.src = image.src;
      thumbnail.alt = "";
      thumbnail.loading = "lazy";

      label.className = "gallery-label";
      label.textContent = image.title;

      button.append(thumbnail, label);
      return button;
    })
  );

  updateGalleryCurrent();
}

function updateGalleryCurrent() {
  const buttons = elements.gallery.querySelectorAll(".gallery-button");
  buttons.forEach((button, index) => {
    button.setAttribute("aria-current", String(index === state.currentIndex));
  });
}

function updateControls() {
  const hasMultipleImages = state.images.length > 1;
  elements.previous.disabled = !hasMultipleImages;
  elements.next.disabled = !hasMultipleImages;
}

function updateImageCount() {
  const count = state.images.length;
  elements.imageCount.textContent = `${count} ${count === 1 ? "image" : "images"}`;
}

function queueRender() {
  if (!state.textureReady || state.renderQueued) {
    return;
  }

  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderer.render();
  });
}

function resizeCanvasToDisplaySize(canvas, gl) {
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * deviceScale));
  const height = Math.max(1, Math.floor(canvas.clientHeight * deviceScale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
}

function getPinchDistance() {
  if (state.activePointers.size < 2) {
    return null;
  }

  const [first, second] = [...state.activePointers.values()];
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointerFromEvent(event) {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function setStatus(message) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-hidden", message.length === 0);
}

function setTitle(title) {
  elements.imageTitle.textContent = title;
}

function titleFromPath(src) {
  const filename = decodeURIComponent(src.split("/").pop() || src);

  return titleFromName(filename);
}

function titleFromName(filename) {
  const basename = filename.replace(/\.[^.]+$/, "");

  return basename
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
