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

function Receiver() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const foundRef = useRef(false);
  const onCountRef = useRef(0);
  const offCountRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(false);
  const [info, setInfo] = useState("—");
  const [position, setPosition] = useState("—");
  const [orientation, setOrientation] = useState("—");
  const [error, setError] = useState("");

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

        // 外枠の中心から周囲を探索し、右下の目印に相当する小さな黒領域を探す。
        // 目印はマーカー本体から少し離れているので、外枠と接続していない。
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

            // マーカー本体の外側にある黒画素を、近さと小ささで候補化する。
            const direction = Math.atan2(dy, dx);
            const distanceScore = 1 - Math.abs(distance - Math.min(bw, bh) * 0.76) / (Math.min(bw, bh) * 0.30);
            candidates.push({ x, y, score: Math.max(0, distanceScore) });
            if (candidates.length > 500) break;
            void direction;
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

        // 本物の目印なら中心から右下方向に来る。画面上の角度を算出する。
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
          setOrientation(`目印方向 ${Math.round(bestAngle)}°`);
        } else {
          setOrientation("目印を探索中");
        }

        if (!foundRef.current && onCountRef.current >= FOUND_ON_FRAMES) {
          foundRef.current = true;
          setFound(true);
        }
      } else {
        offCountRef.current += 1;
        onCountRef.current = 0;
        if (foundRef.current && offCountRef.current >= FOUND_OFF_FRAMES) {
          foundRef.current = false;
          setFound(false);
          setPosition("—");
          setOrientation("—");
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

function App() {
  const [mode, setMode] = useState<"select" | "send" | "receive">("select");

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
          </div>
        )}

        {mode !== "select" && (
          <>
            {mode === "send" ? <Sender /> : <Receiver />}
            <button className="reset" onClick={() => setMode("select")}>最初に戻る</button>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
