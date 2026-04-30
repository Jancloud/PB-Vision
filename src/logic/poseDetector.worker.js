import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  createPoseMovingAverageFilter,
  DEFAULT_MOVING_AVERAGE_WINDOW,
} from "./pose_processing";

const POSE_INDEX = {
  left: { shoulder: 11, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, hip: 24, knee: 26, ankle: 28 },
};

let poseLandmarker = null;
let currentMinConfidence = 0.6;
let poseSmoother = createPoseMovingAverageFilter(DEFAULT_MOVING_AVERAGE_WINDOW);

function buildError(code, message, details = null) {
  return {
    ok: false,
    error: { code, message, details },
  };
}

function mapLandmark(landmark, frameWidth, frameHeight) {
  return {
    x: landmark.x,
    y: landmark.y,
    pixelX: landmark.x * frameWidth,
    pixelY: landmark.y * frameHeight,
    confidence: landmark.visibility ?? landmark.presence ?? 0,
  };
}

function readJointGroup(landmarks, side, frameWidth, frameHeight) {
  const idx = POSE_INDEX[side];
  return {
    shoulder: mapLandmark(landmarks[idx.shoulder], frameWidth, frameHeight),
    hip: mapLandmark(landmarks[idx.hip], frameWidth, frameHeight),
    knee: mapLandmark(landmarks[idx.knee], frameWidth, frameHeight),
    ankle: mapLandmark(landmarks[idx.ankle], frameWidth, frameHeight),
  };
}

function calcGroupScore(group) {
  const points = [group.shoulder, group.hip, group.knee, group.ankle];
  const sum = points.reduce((acc, p) => acc + (p.confidence ?? 0), 0);
  return sum / points.length;
}

function getLowConfidenceJoints(group, minConfidence) {
  return Object.entries(group)
    .filter(([, point]) => (point.confidence ?? 0) < minConfidence)
    .map(([joint, point]) => ({
      joint,
      confidence: Number((point.confidence ?? 0).toFixed(3)),
    }));
}

async function initialize(options = {}) {
  if (poseLandmarker) {
    return { ok: true };
  }

  currentMinConfidence = options.minConfidence ?? 0.6;
  poseSmoother = createPoseMovingAverageFilter(
    options.smoothingWindow ?? DEFAULT_MOVING_AVERAGE_WINDOW
  );
  const localWasmBase = options.localWasmBasePath || "/mediapipe/wasm";
  const localModelBase = options.localModelBasePath || "/mediapipe/models";
  const modelVariant = options.modelVariant === "full" ? "full" : "lite";
  const modelFile =
    modelVariant === "full"
      ? "pose_landmarker_full.task"
      : "pose_landmarker_lite.task";
  const modelUrl = `${localModelBase}/${modelFile}`;

  try {
    const vision = await FilesetResolver.forVisionTasks(localWasmBase);

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelUrl,
      },
      runningMode: options.runningMode || "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: currentMinConfidence,
      minPosePresenceConfidence: currentMinConfidence,
      minTrackingConfidence: currentMinConfidence,
      outputSegmentationMasks: false,
    });

    return { ok: true };
  } catch (err) {
    return buildError("POSE_INIT_FAILED", "MediaPipe model init failed.", String(err?.message || err));
  }
}

function detectPoseFromFrame(frame, options = {}) {
  if (!poseLandmarker) {
    return buildError("POSE_NOT_READY", "Model is not initialized.");
  }

  const frameWidth = frame.frameWidth || frame.imageBitmap?.width;
  const frameHeight = frame.frameHeight || frame.imageBitmap?.height;
  const minConfidence = options.minConfidence ?? currentMinConfidence;
  const timestampMs = Number(frame.timestampMs || performance.now());
  const imageBitmap = frame.imageBitmap;

  if (!imageBitmap) {
    return buildError("INVALID_FRAME", "Missing frame.");
  }

  if (!frameWidth || !frameHeight) {
    imageBitmap.close?.();
    return buildError("INVALID_FRAME_SIZE", "Invalid frame size.");
  }

  const startedAt = performance.now();
  try {
    const result = poseLandmarker.detectForVideo(imageBitmap, timestampMs);
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));

    if (!result?.landmarks?.[0]) {
      poseSmoother.reset();
      return buildError("NO_PERSON_DETECTED", "No person detected in this frame.", { elapsedMs });
    }

    const landmarks = result.landmarks[0];
    const leftGroup = readJointGroup(landmarks, "left", frameWidth, frameHeight);
    const rightGroup = readJointGroup(landmarks, "right", frameWidth, frameHeight);
    const leftScore = calcGroupScore(leftGroup);
    const rightScore = calcGroupScore(rightGroup);
    const selectedSide = leftScore >= rightScore ? "left" : "right";
    const selectedGroup = selectedSide === "left" ? leftGroup : rightGroup;
    const lowConfidenceJoints = getLowConfidenceJoints(selectedGroup, minConfidence);

    if (lowConfidenceJoints.length > 0) {
      poseSmoother.reset(selectedSide);
      return buildError("LOW_CONFIDENCE", "Low confidence keypoints.", {
        selectedSide,
        minConfidence,
        lowConfidenceJoints,
        elapsedMs,
      });
    }

    const smoothedGroup = poseSmoother.smoothPoseGroup(selectedGroup, selectedSide);
    if (!smoothedGroup) {
      return buildError("POSE_SMOOTHING_ERROR", "Pose smoothing failed.");
    }

    return {
      ok: true,
      data: smoothedGroup,
      meta: {
        selectedSide,
        score: Number(Math.max(leftScore, rightScore).toFixed(3)),
        frameSize: { width: frameWidth, height: frameHeight },
        elapsedMs,
        smoothingWindow: poseSmoother.windowSize,
      },
    };
  } catch (err) {
    return buildError("POSE_RUNTIME_ERROR", "Pose runtime error.", String(err?.message || err));
  } finally {
    imageBitmap.close?.();
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || !msg.type) {
    return;
  }

  if (msg.type === "init") {
    const initResult = await initialize(msg.options || {});
    if (initResult.ok) {
      self.postMessage({ type: "worker_ready" });
    } else {
      self.postMessage({
        type: "worker_init_error",
        message: initResult.error.message,
        details: initResult.error.details,
      });
    }
    return;
  }

  if (msg.type === "detect") {
    const payload = detectPoseFromFrame(msg.frame || {}, msg.options || {});
    self.postMessage({
      type: "detect_result",
      requestId: msg.requestId,
      payload,
    });
    return;
  }

  if (msg.type === "dispose") {
    if (poseLandmarker) {
      poseLandmarker.close();
      poseLandmarker = null;
    }
    poseSmoother.reset();
  }
};
