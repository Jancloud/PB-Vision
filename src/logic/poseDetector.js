const DEFAULT_OPTIONS = {
  minConfidence: 0.6,
  timeoutMs: 4000,
  runningMode: "VIDEO",
  modelVariant: "lite",
};

let worker = null;
let initPromise = null;
let initialized = false;
let requestSeq = 0;
const pendingMap = new Map();

function buildError(code, message, details = null) {
  return {
    ok: false,
    error: { code, message, details },
  };
}

function resolvePending(requestId, payload) {
  const pending = pendingMap.get(requestId);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeoutId);
  pendingMap.delete(requestId);
  pending.resolve(payload);
}

function rejectAllPending(errorPayload) {
  for (const [, pending] of pendingMap) {
    clearTimeout(pending.timeoutId);
    pending.resolve(errorPayload);
  }
  pendingMap.clear();
}

function ensureWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL("./poseDetector.worker.js", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }

    if (msg.type === "worker_ready") {
      initialized = true;
      if (initPromise?.resolve) {
        initPromise.resolve({ ok: true });
      }
      initPromise = null;
      return;
    }

    if (msg.type === "worker_init_error") {
      initialized = false;
      if (initPromise?.resolve) {
        initPromise.resolve(buildError("POSE_INIT_FAILED", msg.message || "Model init failed", msg.details));
      }
      initPromise = null;
      return;
    }

    if (msg.type === "detect_result") {
      resolvePending(msg.requestId, msg.payload);
    }
  };

  worker.onerror = (err) => {
    initialized = false;
    if (initPromise?.resolve) {
      initPromise.resolve(
        buildError("WORKER_CRASHED", "Worker crashed. Please refresh and retry.", String(err?.message || err))
      );
    }
    initPromise = null;
    rejectAllPending(buildError("WORKER_CRASHED", "Worker crashed. Please refresh and retry."));
  };

  return worker;
}

export async function initPoseDetector(options = {}) {
  if (initialized) {
    return { ok: true };
  }

  if (initPromise) {
    return initPromise.promise;
  }

  ensureWorker();
  const merged = { ...DEFAULT_OPTIONS, ...options };

  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });
  initPromise = { promise, resolve: resolveFn };

  worker.postMessage({
    type: "init",
    options: merged,
  });

  return promise;
}

/**
 * Main-thread proxy: forward frame to Worker only.
 * @param {{
 *   imageBitmap: ImageBitmap,
 *   frameWidth: number,
 *   frameHeight: number,
 *   timestampMs: number
 * }} framePayload
 * @param {{minConfidence?: number, timeoutMs?: number}} options
 */
export async function detectPoseFromVideo(framePayload, options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const initResult = await initPoseDetector(merged);
  if (!initResult.ok) {
    return initResult;
  }

  const { imageBitmap, frameWidth, frameHeight, timestampMs } = framePayload || {};
  if (!imageBitmap) {
    return buildError("INVALID_FRAME", "Missing frame payload.");
  }

  if (!frameWidth || !frameHeight) {
    imageBitmap.close?.();
    return buildError("INVALID_FRAME_SIZE", "Invalid frame size.");
  }

  requestSeq += 1;
  const requestId = requestSeq;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingMap.delete(requestId);
      resolve(buildError("POSE_TIMEOUT", "Pose detect timeout. Frame skipped."));
    }, merged.timeoutMs);

    pendingMap.set(requestId, { resolve, timeoutId });

    worker.postMessage(
      {
        type: "detect",
        requestId,
        options: {
          minConfidence: merged.minConfidence,
        },
        frame: {
          imageBitmap,
          frameWidth,
          frameHeight,
          timestampMs,
        },
      },
      [imageBitmap]
    );
  });
}

export function disposePoseDetector() {
  if (!worker) {
    return;
  }

  worker.postMessage({ type: "dispose" });
  worker.terminate();
  worker = null;
  initialized = false;
  initPromise = null;
  rejectAllPending(buildError("WORKER_DISPOSED", "Detector disposed."));
}
