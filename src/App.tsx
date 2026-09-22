import { useEffect, useRef, useState } from "react";

const MARKER = [
  [1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1],
  [1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1],
  [1,1,1,1,1,1,1],
];

const INNER = MARKER.flat();
const FOUND_ON_FRAMES = 3;
const FOUND_OFF_FRAMES = 5;
const ANGLE_HISTORY_SIZE = 5;
const ANGLE_HOLD_FRAMES = 5;

function Marker() {
  return (
    <div className="marker-board">
      <div className="marker-grid">
        {INNER.map((bit, i) => <span key={i} className={bit ? "marker-cell on" : "marker-cell"} />)}
      </div>
      <div className="marker-dot" />
    </div>
  );
}

function Sender() {
  return (
    <div className="optical-panel">
      <div className="mode-label">送信側</div>
      <h2>向き・角度検出テスト</h2>
      <p className="hint">マーカー右下の目印を使って、位置・大きさ・向きを推定します。</p>
      <Marker />
      <div className="detect-marker">ORIENTATION DETECTION TEST</div>
    </div>
  );
}

function circularAverage(angles: number[]) {
  if (angles.length === 0) return null;

  let sin = 0;
  let cos = 0;

  for (const angle of angles) {
    const radians = angle * Math.PI / 180;
    sin += Math.sin(radians);
    cos += Math.cos(radians);
  }

  let result = Math.atan2(sin / angles.length, cos / angles.length) * 180 / Math.PI;
  if (result < 0) result += 360;
  return result;
}

function Receiver() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const foundRef = useRef(false);
  const onCountRef = useRef(0);
  const offCountRef = useRef(0);
  const angleHistoryRef = useRef<number[]>([]);
  const lastAngleRef = useRef<number | null>(null);
  const angleMissCountRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(false);
  const [info, setInfo] = useState("—");
  const [position, setPosition] = useState("—");
  const [orientation, setOrientation] = useState("—");
  const [error, setError] = useState("");

  const resetAngleSmoothing = () => {
    angleHistoryRef.current = [];
    lastAngleRef.current = null;
    angleMissCountRef.current = 0;
  };

  const stop = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    foundRef.current = false;
    onCountRef.current = 0;
    offCountRef.current = 0;
    resetAngleSmoothing();
    setFound(false);
    setPosition("—");
    setOrientation("—");
    setRunning(false);
  };

  const scan = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) {
      frameRef.current = requestAnimationFrame(scan);
      return;
    }

    const size = 320;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (ctx) {
      const sourceSize = Math.min(video.videoWidth, video.videoHeight);
      const sx = (video.videoWidth - sourceSize) / 2;
      const sy = (video.videoHeight - sourceSize) / 2;
      ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

      const image = ctx.getImageData(0, 0, size, size);
      const data = image.data;

      const block = 4;
      const w = size / block;
      const h = size / block;
      const gray = new Uint8Array(w * h);

      for (let by = 0; by < h; by++) {
        for (let bx = 0; bx < w; bx++) {
          let total = 0;
          for (let y = 0; y < block; y++) {
            for (let x = 0; x < block; x++) {
              const p = ((by * block + y) * size + bx * block + x) * 4;
              total += (data[p] + data[p + 1] + data[p + 2]) / 3;
            }
          }
          gray[by * w + bx] = total / (block * block);
        }
      }

      const min = Math.min(...Array.from(gray));
      const max = Math.max(...Array.from(gray));
      const threshold = min + (max - min) * 0.45;
      const dark = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) dark[i] = gray[i] < threshold ? 1 : 0;

      const seen = new Uint8Array(w * h);
      let bestScore = 0;
      let bestArea = 0;
      let bestBox = "";
      let bestCenterX = 0;
      let bestCenterY = 0;
      let bestWidth = 0;
      let bestHeight = 0;
      let bestAngle = 0;
      let bestDotScore = 0;

      for (let start = 0; start < dark.length; start++) {
        if (!dark[start] || seen[start]) continue;

        const queue = [start];
        seen[start] = 1;
        let head = 0;
        let area = 0;
        let minX = w, minY = h, maxX = -1, maxY = -1;

        while (head < queue.length) {
          const p = queue[head++];
          const x = p % w;
          const y = Math.floor(p / w);
          area++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);

          for (const n of [p - 1, p + 1, p - w, p + w]) {
            if (n < 0 || n >= dark.length || seen[n] || !dark[n]) continue;
            const nx = n % w;
            const ny = Math.floor(n / w);
            if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
            seen[n] = 1;
            queue.push(n);
          }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (area < 80 || bw < 12 || bh < 12 || bw > 65 || bh > 65) continue;

        const ratio = bw / bh;
        const fill = area / (bw * bh);
        if (ratio < 0.72 || ratio > 1.28 || fill < 0.45) continue;

        const sample: number[] = [];
        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 7; col++) {
            const px = Math.floor(minX + ((col + 0.5) / 7) * bw);
            const py = Math.floor(minY + ((row + 0.5) / 7) * bh);
            sample.push(gray[py * w + px] < threshold ? 1 : 0);
          }
        }

        let matches = 0;
        for (let i = 0; i < INNER.length; i++) {
          if (sample[i] === INNER[i]) matches++;
        }

        const shapeScore = matches / INNER.length;
        if (shapeScore < 0.82) continue;

        const cx = (minX + maxX + 1) / 2;
        const cy = (minY + maxY + 1) / 2;
        const radiusMin = Math.min(bw, bh) * 0.62;
        const radiusMax = Math.min(bw, bh) * 1.05;
        const candidates: { x: number; y: number; score: number }[] = [];

        for (let y = Math.max(0, Math.floor(cy - radiusMax)); y <= Math.min(h - 1, Math.ceil(cy + radiusMax)); y++) {
          for (let x = Math.max(0, Math.floor(cx - radiusMax)); x <= Math.min(w - 1, Math.ceil(cx + radiusMax)); x++) {
            const dx = x - cx;
            const dy = y - cy;
            const distance = Math.hypot(dx, dy);
            if (distance < radiusMin || distance > radiusMax || dark[y * w + x] === 0) continue;

            const distanceScore = 1 - Math.abs(distance - Math.min(bw, bh) * 0.76) / (Math.min(bw, bh) * 0.30);
            candidates.push({ x, y, score: Math.max(0, distanceScore) });
            if (candidates.length > 500) break;
          }
          if (candidates.length > 500) break;
        }

        let dotX = 0;
        let dotY = 0;
        let dotScore = 0;
        for (const candidate of candidates) {
          if (candidate.score > dotScore) {
            dotScore = candidate.score;
            dotX = candidate.x;
            dotY = candidate.y;
          }
        }

        let angle = 0;
        if (dotScore > 0) {
          angle = Math.atan2(dotY - cy, dotX - cx) * 180 / Math.PI;
          if (angle < 0) angle += 360;
        }

        const score = shapeScore * 0.85 + dotScore * 0.15;
        if (score > bestScore) {
          bestScore = score;
          bestArea = area;
          bestBox = `${minX},${minY} → ${maxX},${maxY}`;
          bestCenterX = cx;
          bestCenterY = cy;
          bestWidth = bw;
          bestHeight = bh;
          bestAngle = angle;
          bestDotScore = dotScore;
        }
      }

      const candidateFound = bestScore >= 0.82 && bestArea >= 80;

      if (candidateFound) {
        onCountRef.current += 1;
        offCountRef.current = 0;

        const normalizedX = Math.round((bestCenterX / w) * 100);
        const normalizedY = Math.round((bestCenterY / h) * 100);
        const sizePercent = Math.round(((bestWidth + bestHeight) / 2 / w) * 100);

        setPosition(`中心 X ${normalizedX}% / Y ${normalizedY}% / サイズ ${sizePercent}%`);

        if (bestDotScore > 0.2) {
          angleMissCountRef.current = 0;
          angleHistoryRef.current.push(bestAngle);

          if (angleHistoryRef.current.length > ANGLE_HISTORY_SIZE) {
            angleHistoryRef.current.shift();
          }

          const smoothedAngle = circularAverage(angleHistoryRef.current);
          if (smoothedAngle !== null) {
            lastAngleRef.current = smoothedAngle;
            setOrientation(`目印方向 ${Math.round(smoothedAngle)}°`);
          }
        } else {
          angleMissCountRef.current += 1;

          if (lastAngleRef.current !== null && angleMissCountRef.current <= ANGLE_HOLD_FRAMES) {
            setOrientation(`目印方向 ${Math.round(lastAngleRef.current)}°`);
          } else {
            setOrientation("目印を探索中");
          }
        }

        if (!foundRef.current && onCountRef.current >= FOUND_ON_FRAMES) {
          foundRef.current = true;
          setFound(true);
        }
      } else {
        offCountRef.current += 1;
        onCountRef.current = 0;
        angleMissCountRef.current += 1;

        if (lastAngleRef.current !== null && angleMissCountRef.current <= ANGLE_HOLD_FRAMES) {
          setOrientation(`目印方向 ${Math.round(lastAngleRef.current)}°`);
        } else if (foundRef.current) {
          setOrientation("目印を探索中");
        }

        if (foundRef.current && offCountRef.current >= FOUND_OFF_FRAMES) {
          foundRef.current = false;
          setFound(false);
          setPosition("—");
          setOrientation("—");
          resetAngleSmoothing();
        }
      }

      setInfo(
        bestScore > 0
          ? `形状一致 ${Math.round(bestScore * 100)}% / 面積 ${bestArea} / ${bestBox}`
          : `探索中 / 明暗差 ${Math.round(max - min)}`,
      );
    }

    frameRef.current = requestAnimationFrame(scan);
  };

  const start = async () => {
    try {
      setError("");
      setFound(false);
      foundRef.current = false;
      onCountRef.current = 0;
      offCountRef.current = 0;
      resetAngleSmoothing();
      setPosition("—");
      setOrientation("—");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      frameRef.current = requestAnimationFrame(scan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "カメラを起動できませんでした。");
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <div className="optical-panel">
      <div className="mode-label">受信側</div>
      <h2>向きを探す</h2>
      <p className="hint">マーカーを回すと、右下の目印の方向から角度を推定します。</p>

      <div className={`camera-wrap ${found ? "marker-found" : ""}`}>
        <video ref={videoRef} muted playsInline />
        <div className="scan-hud">
          <span>{found ? "MARKER FOUND" : "SEARCHING..."}</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden-canvas" />

      {!running ? (
        <button className="primary" onClick={start}>カメラを起動</button>
      ) : (
        <button className="secondary" onClick={stop}>カメラを停止</button>
      )}

      <div className={found ? "receive-result success" : "receive-result"}>
        <span>{found ? "マーカーの向きを取得" : "マーカー検出待ち"}</span>
        <strong>{found ? "FOUND" : "—"}</strong>
      </div>

      <div className="debug-panel">
        <div className="debug-title">位置情報</div>
        <div className="debug-info">{position}</div>
        <div className="debug-title">向き</div>
        <div className="debug-info">{orientation}</div>
        <div className="debug-title">検出情報</div>
        <div className="debug-info">{info}</div>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}


function convexHull(points: { x: number; y: number }[]) {
  if (points.length <= 3) return points;

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}


function findOcclusionTolerantBox(
  dark: Uint8Array,
  w: number,
  h: number,
  marker: number[][],
) {
  let best: {
    score: number;
    x: number;
    y: number;
    size: number;
    visibleDark: number;
  } | null = null;

  // Search for the full 7x7 structure, while treating cells covered by a
  // finger as unknown rather than simply "wrong". In particular, require
  // evidence from the outer ring so the central 3x3 black block alone can
  // never become a valid marker.
  const outerCells: { row: number; col: number }[] = [];
  const innerCells: { row: number; col: number }[] = [];

  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      if (row === 0 || row === 6 || col === 0 || col === 6) {
        outerCells.push({ row, col });
      } else {
        innerCells.push({ row, col });
      }
    }
  }

  for (let size = 20; size <= 72; size += 4) {
    for (let y = 0; y <= h - size; y += 3) {
      for (let x = 0; x <= w - size; x += 3) {
        let matches = 0;
        let knownCells = 0;
        let expectedDark = 0;
        let visibleDark = 0;
        let outerMatches = 0;
        let outerKnown = 0;
        let outerDark = 0;

        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 7; col++) {
            const px = Math.min(
              w - 1,
              Math.floor(x + ((col + 0.5) / 7) * size),
            );
            const py = Math.min(
              h - 1,
              Math.floor(y + ((row + 0.5) / 7) * size),
            );
            const observed = dark[py * w + px];
            const expected = marker[row][col];
            const isOuter = row === 0 || row === 6 || col === 0 || col === 6;

            if (expected === 1) {
              expectedDark++;
              if (observed) {
                matches++;
                knownCells++;
                visibleDark++;
                if (isOuter) outerDark++;
              }
            } else if (!observed) {
              matches++;
              knownCells++;
            }

            if (isOuter) {
              // A visible black outer cell is especially strong evidence
              // that this is the actual marker rather than the center block.
              if (observed === Boolean(expected)) outerMatches++;
              outerKnown++;
            }
          }
        }

        const score = matches / 49;
        const darkVisibility = visibleDark / expectedDark;
        const outerScore = outerMatches / outerKnown;

        // Require the outer structure to be substantially visible.
        // This rejects the central black 3x3 block when the border is hidden.
        if (outerDark < 8) continue;
        if (outerScore < 0.55) continue;
        if (darkVisibility < 0.45) continue;
        if (knownCells < 30) continue;
        if (score < 0.72) continue;

        // Require at least one visible black corner-region cell and one
        // visible black cell away from the center. This prevents a compact
        // central region from masquerading as the whole marker.
        let cornerEvidence = 0;
        let outerMidEvidence = 0;

        for (const cell of outerCells) {
          const px = Math.min(
            w - 1,
            Math.floor(x + ((cell.col + 0.5) / 7) * size),
          );
          const py = Math.min(
            h - 1,
            Math.floor(y + ((cell.row + 0.5) / 7) * size),
          );
          if (dark[py * w + px] && marker[cell.row][cell.col] === 1) {
            if (
              (cell.row <= 1 || cell.row >= 5) &&
              (cell.col <= 1 || cell.col >= 5)
            ) {
              cornerEvidence++;
            } else {
              outerMidEvidence++;
            }
          }
        }

        if (cornerEvidence < 2 || outerMidEvidence < 4) continue;

        if (
          !best ||
          score > best.score ||
          (score === best.score && outerScore > best.score)
        ) {
          best = {
            score,
            x,
            y,
            size,
            visibleDark,
          };
        }
      }
    }
  }

  return best;
}

function ObliqueTestReceiver() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const warpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const warpedFoundRef = useRef(false);
  const warpedOnCountRef = useRef(0);
  const warpedOffCountRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(false);
  const [warpedFound, setWarpedFound] = useState(false);
  const [warpScore, setWarpScore] = useState(0);
  const [corners, setCorners] = useState("—");
  const [error, setError] = useState("");

  const stop = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    setRunning(false);
    setFound(false);
    warpedFoundRef.current = false;
    warpedOnCountRef.current = 0;
    warpedOffCountRef.current = 0;
    setWarpedFound(false);
    setWarpScore(0);
    setCorners("—");
  };

  const warpPerspective = (
    sourceCtx: CanvasRenderingContext2D,
    outputCtx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    p: { x: number; y: number }[],
    outputSize: number,
  ) => {
    const image = sourceCtx.getImageData(0, 0, source.width, source.height);
    const src = image.data;
    const output = outputCtx.createImageData(outputSize, outputSize);
    const dst = output.data;

    const [tl, tr, br, bl] = p;
    const topDx = tr.x - tl.x;
    const topDy = tr.y - tl.y;
    const rightDx = br.x - tr.x;
    const rightDy = br.y - tr.y;
    const bottomDx = br.x - bl.x;
    const bottomDy = br.y - bl.y;
    const leftDx = bl.x - tl.x;
    const leftDy = bl.y - tl.y;

    const widthTop = Math.hypot(topDx, topDy);
    const widthBottom = Math.hypot(bottomDx, bottomDy);
    const heightLeft = Math.hypot(leftDx, leftDy);
    const heightRight = Math.hypot(rightDx, rightDy);
    const topWidth = Math.max(1, widthTop);
    const bottomWidth = Math.max(1, widthBottom);
    const leftHeight = Math.max(1, heightLeft);
    const rightHeight = Math.max(1, heightRight);

    const sampleBilinear = (x: number, y: number) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const y1 = Math.min(source.height - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const out = [0, 0, 0, 255];

      for (let c = 0; c < 3; c++) {
        const i00 = (y0 * source.width + x0) * 4 + c;
        const i10 = (y0 * source.width + x1) * 4 + c;
        const i01 = (y1 * source.width + x0) * 4 + c;
        const i11 = (y1 * source.width + x1) * 4 + c;
        out[c] =
          src[i00] * (1 - fx) * (1 - fy) +
          src[i10] * fx * (1 - fy) +
          src[i01] * (1 - fx) * fy +
          src[i11] * fx * fy;
      }
      return out;
    };

    for (let y = 0; y < outputSize; y++) {
      const v = y / (outputSize - 1);
      for (let x = 0; x < outputSize; x++) {
        const u = x / (outputSize - 1);
        const topX = tl.x + (tr.x - tl.x) * u;
        const topY = tl.y + (tr.y - tl.y) * u;
        const bottomX = bl.x + (br.x - bl.x) * u;
        const bottomY = bl.y + (br.y - bl.y) * u;
        const px = topX + (bottomX - topX) * v;
        const py = topY + (bottomY - topY) * v;
        const color = sampleBilinear(px, py);
        const i = (y * outputSize + x) * 4;
        dst[i] = color[0];
        dst[i + 1] = color[1];
        dst[i + 2] = color[2];
        dst[i + 3] = 255;
      }
    }

    outputCtx.putImageData(output, 0, 0);
  };

  const recognizeWarpedMarker = (warpCtx: CanvasRenderingContext2D) => {
    const size = 320;
    const image = warpCtx.getImageData(0, 0, size, size);
    const data = image.data;
    const sample: number[] = [];
    let min = 255;
    let max = 0;

    for (let i = 0; i < size * size; i++) {
      const p = i * 4;
      const value = (data[p] + data[p + 1] + data[p + 2]) / 3;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    const threshold = min + (max - min) * 0.45;

    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const px = Math.min(size - 1, Math.floor(((col + 0.5) / 7) * size));
        const py = Math.min(size - 1, Math.floor(((row + 0.5) / 7) * size));
        const p = (py * size + px) * 4;
        const value = (data[p] + data[p + 1] + data[p + 2]) / 3;
        sample.push(value < threshold ? 1 : 0);
      }
    }

    let matches = 0;
    for (let i = 0; i < INNER.length; i++) {
      if (sample[i] === INNER[i]) matches++;
    }

    const score = matches / INNER.length;
    setWarpScore(Math.round(score * 100));

    if (score >= 0.82) {
      warpedOnCountRef.current += 1;
      warpedOffCountRef.current = 0;
      if (!warpedFoundRef.current && warpedOnCountRef.current >= FOUND_ON_FRAMES) {
        warpedFoundRef.current = true;
        setWarpedFound(true);
      }
    } else {
      warpedOffCountRef.current += 1;
      warpedOnCountRef.current = 0;
      if (warpedFoundRef.current && warpedOffCountRef.current >= FOUND_OFF_FRAMES) {
        warpedFoundRef.current = false;
        setWarpedFound(false);
      }
    }
  };

  const scan = () => {
    const video = videoRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    const warpCanvas = warpCanvasRef.current;
    if (!video || !sourceCanvas || !warpCanvas || video.readyState < 2 || !video.videoWidth) {
      frameRef.current = requestAnimationFrame(scan);
      return;
    }

    const size = 320;
    sourceCanvas.width = size;
    sourceCanvas.height = size;
    warpCanvas.width = 320;
    warpCanvas.height = 320;

    const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const warpCtx = warpCanvas.getContext("2d");
    if (!ctx || !warpCtx) {
      frameRef.current = requestAnimationFrame(scan);
      return;
    }

    warpCtx.fillStyle = "#ffffff";
    warpCtx.fillRect(0, 0, 320, 320);

    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - sourceSize) / 2;
    const sy = (video.videoHeight - sourceSize) / 2;
    ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

    const image = ctx.getImageData(0, 0, size, size);
    const data = image.data;
    const block = 4;
    const w = size / block;
    const h = size / block;
    const gray = new Uint8Array(w * h);

    for (let by = 0; by < h; by++) {
      for (let bx = 0; bx < w; bx++) {
        let total = 0;
        for (let y = 0; y < block; y++) {
          for (let x = 0; x < block; x++) {
            const p = ((by * block + y) * size + bx * block + x) * 4;
            total += (data[p] + data[p + 1] + data[p + 2]) / 3;
          }
        }
        gray[by * w + bx] = total / (block * block);
      }
    }

    const min = Math.min(...Array.from(gray));
    const max = Math.max(...Array.from(gray));
    const threshold = min + (max - min) * 0.45;
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) dark[i] = gray[i] < threshold ? 1 : 0;

    const seen = new Uint8Array(w * h);
    let bestArea = 0;
    let bestPoints: { x: number; y: number }[] = [];

    // Primary detector: connected dark region, which is fast and works well
    // when the marker is fully visible.
    for (let start = 0; start < dark.length; start++) {
      if (!dark[start] || seen[start]) continue;
      const queue = [start];
      seen[start] = 1;
      let head = 0;
      const points: { x: number; y: number }[] = [];

      while (head < queue.length) {
        const p = queue[head++];
        const x = p % w;
        const y = Math.floor(p / w);
        points.push({ x, y });

        for (const n of [p - 1, p + 1, p - w, p + w]) {
          if (n < 0 || n >= dark.length || seen[n] || !dark[n]) continue;
          const nx = n % w;
          const ny = Math.floor(n / w);
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
          seen[n] = 1;
          queue.push(n);
        }
      }

      if (points.length < 80 || points.length <= bestArea) continue;
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < 12 || bh < 12 || bw > 75 || bh > 75) continue;
      bestArea = points.length;
      bestPoints = points;
    }

    // Primary connected-component detection gives accurate corners when
    // the marker is fully visible. If a finger hides a corner, fall back
    // to the tolerant template detector and reconstruct the hidden corners
    // from the estimated full marker square.
    let estimatedPoints: { x: number; y: number }[] | null = null;

    if (bestPoints.length > 0) {
      const hull = convexHull(bestPoints);
      if (hull.length >= 4) {
        const tl = hull.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b));
        const br = hull.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
        const tr = hull.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b));
        const bl = hull.reduce((a, b) => (a.x - a.y < b.x - b.y ? a : b));
        estimatedPoints = [tl, tr, br, bl];
      }
    }

    if (!estimatedPoints) {
      const fallback = findOcclusionTolerantBox(dark, w, h, MARKER);

      if (fallback) {
        // The fallback gives us the estimated full marker rectangle, not
        // just the visible black pixels. Those four corners remain valid
        // even when one or more physical corners are hidden.
        estimatedPoints = [
          { x: fallback.x / block, y: fallback.y / block },
          { x: (fallback.x + fallback.size) / block, y: fallback.y / block },
          { x: (fallback.x + fallback.size) / block, y: (fallback.y + fallback.size) / block },
          { x: fallback.x / block, y: (fallback.y + fallback.size) / block },
        ];
        bestArea = fallback.visibleDark;
      }
    }

    if (estimatedPoints) {
      const points = estimatedPoints;

      ctx.strokeStyle = "#55c98a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      points.forEach((p, i) => {
        const px = (p.x + 0.5) * block;
        const py = (p.y + 0.5) * block;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();

      warpPerspective(ctx, warpCtx, sourceCanvas, points.map((p) => ({
        x: (p.x + 0.5) * block,
        y: (p.y + 0.5) * block,
      })), 320);

      recognizeWarpedMarker(warpCtx);
      setFound(true);
      setCorners(
        points
          .map((p, i) => {
            const names = ["左上", "右上", "右下", "左下"];
            return `${names[i]} ${Math.round((p.x / w) * 100)}%,${Math.round((p.y / h) * 100)}%`;
          })
          .join(" / "),
      );
    } else {
      setFound(false);
      setCorners("マーカーを探索中");
    }

    frameRef.current = requestAnimationFrame(scan);
  };

  const start = async () => {
    try {
      setError("");
      warpedFoundRef.current = false;
      warpedOnCountRef.current = 0;
      warpedOffCountRef.current = 0;
      setWarpedFound(false);
      setWarpScore(0);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      frameRef.current = requestAnimationFrame(scan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "カメラを起動できませんでした。");
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <div className="optical-panel">
      <div className="mode-label">透視補正テスト</div>
      <h2>斜めを正面に戻す</h2>
      <p className="hint">検出した四隅から正方形に補正し、その補正後の画像で7×7認識を試します。</p>

      <div className="warp-test-layout">
        <div>
          <div className="test-label">元映像</div>
          <div className="camera-wrap oblique-camera">
            <video ref={videoRef} muted playsInline />
            <canvas ref={sourceCanvasRef} className="camera-overlay" />
            <div className="scan-hud"><span>{found ? "CORNERS FOUND" : "SEARCHING..."}</span></div>
          </div>
        </div>
        <div>
          <div className="test-label">透視補正後</div>
          <div className="warp-preview">
            <canvas ref={warpCanvasRef} />
            <div className={warpedFound ? "warp-status found" : "warp-status"}>
              {warpedFound ? "7×7 FOUND" : "7×7 SEARCHING"}
            </div>
          </div>
        </div>
      </div>

      {!running ? (
        <button className="primary" onClick={start}>カメラを起動</button>
      ) : (
        <button className="secondary" onClick={stop}>カメラを停止</button>
      )}

      <div className={found ? "receive-result success" : "receive-result"}>
        <span>{warpedFound ? "透視補正後の7×7認識" : found ? "四隅から透視補正中" : "四隅検出待ち"}</span>
        <strong>{warpedFound ? "FOUND" : found ? "WARPED" : "—"}</strong>
      </div>

      <div className="debug-panel">
        <div className="debug-title">7×7認識スコア</div>
        <div className="debug-info">{warpScore}%</div>
        <div className="debug-title">検出した四隅</div>
        <div className="debug-info">{corners}</div>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<"select" | "send" | "receive" | "oblique">("select");

  return (
    <main className="app">
      <section className="card">
        <div className="eyebrow">OPTICAL MARKER ORIENTATION TEST</div>
        <h1>独自マーカー向き検出</h1>
        <p className="sub">マーカーを発見したあと、位置・大きさ・向きを取得します。</p>

        {mode === "select" && (
          <div className="role-grid">
            <button className="role-button" onClick={() => setMode("send")}>
              <span>送信側</span>
              <strong>模様を表示</strong>
              <small>向き検出用マーカー</small>
            </button>
            <button className="role-button" onClick={() => setMode("receive")}>
              <span>受信側</span>
              <strong>カメラで探す</strong>
              <small>位置・大きさ・向きを取得</small>
            </button>
            <button className="role-button" onClick={() => setMode("oblique")}>
              <span>斜めテスト</span>
              <strong>四隅を探す</strong>
              <small>7×7認識なしの基礎テスト</small>
            </button>
          </div>
        )}

        {mode !== "select" && (
          <>
            {mode === "send" ? <Sender /> : mode === "receive" ? <Receiver /> : <ObliqueTestReceiver />}
            <button className="reset" onClick={() => setMode("select")}>最初に戻る</button>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
