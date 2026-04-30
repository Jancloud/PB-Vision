const JOINT_KEYS = ["shoulder", "hip", "knee", "ankle"];
const COORD_KEYS = ["x", "y", "pixelX", "pixelY"];

export const DEFAULT_MOVING_AVERAGE_WINDOW = 5;

function createCoordBuffer() {
  return { x: [], y: [], pixelX: [], pixelY: [] };
}

function createJointBuffers() {
  return {
    shoulder: createCoordBuffer(),
    hip: createCoordBuffer(),
    knee: createCoordBuffer(),
    ankle: createCoordBuffer(),
  };
}

function pushWindow(list, value, windowSize) {
  list.push(value);
  if (list.length > windowSize) {
    list.shift();
  }
}

function mean(list) {
  if (!list.length) return 0;
  return list.reduce((sum, n) => sum + n, 0) / list.length;
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 关键点去噪器：对每个关节坐标做滑动平均（Moving Average）。
 * 说明：这里只平滑“坐标”，不改置信度，避免掩盖低置信度问题。
 */
export function createPoseMovingAverageFilter(windowSize = DEFAULT_MOVING_AVERAGE_WINDOW) {
  const finalWindowSize = Math.max(1, Math.floor(toFiniteNumber(windowSize, DEFAULT_MOVING_AVERAGE_WINDOW)));
  const buffersBySide = {
    left: createJointBuffers(),
    right: createJointBuffers(),
  };

  function smoothPoseGroup(group, side = "left") {
    if (!group) return null;
    const sideKey = side === "right" ? "right" : "left";
    const sideBuffers = buffersBySide[sideKey];
    const smoothedGroup = {};

    for (const joint of JOINT_KEYS) {
      const point = group[joint];
      if (!point) {
        return null;
      }

      const jointBuffer = sideBuffers[joint];
      const smoothedPoint = { ...point };

      for (const key of COORD_KEYS) {
        pushWindow(jointBuffer[key], toFiniteNumber(point[key]), finalWindowSize);
        smoothedPoint[key] = mean(jointBuffer[key]);
      }

      smoothedGroup[joint] = smoothedPoint;
    }

    return smoothedGroup;
  }

  function reset(side) {
    if (side === "left" || side === "right") {
      buffersBySide[side] = createJointBuffers();
      return;
    }
    buffersBySide.left = createJointBuffers();
    buffersBySide.right = createJointBuffers();
  }

  return {
    smoothPoseGroup,
    reset,
    windowSize: finalWindowSize,
  };
}

