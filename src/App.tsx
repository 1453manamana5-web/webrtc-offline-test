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
      <h2>形状認識テスト</h2>
      <p className="hint">このマーカー特有の「外枠＋中央形状＋右下の目印」を認識します。</p>
      <Marker />
      <div className="detect-marker">SHAPE MATCH TEST</div>
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

        const dotX = Math.floor(minX + bw * 1.12);
        const dotY = Math.floor(minY + bh * 1.12);
        let dotDark = false;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = dotX + dx;
            const y = dotY + dy;
            if (x >= 0 && x < w && y >= 0 && y < h && gray[y * w + x] < threshold) dotDark = true;
          }
        }

        const score = shapeScore * 0.85 + (dotDark ? 0.15 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestArea = area;
          bestBox = `${minX},${minY} → ${maxX},${maxY}`;
        }
      }

      const candidateFound = bestScore >= 0.82 && bestArea >= 80;

      if (candidateFound) {
        onCountRef.current += 1;
        offCountRef.current = 0;
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
        }
      }

      setInfo(
        bestScore > 0
          ? `形状一致 ${Math.round(bestScore * 100)}% / 面積 ${bestArea} / ${bestBox} / ${foundRef.current ? "安定検出" : "候補"}`
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
      <h2>マーカーを探す</h2>
      <p className="hint">3フレーム連続で確認してFOUNDにし、5フレーム連続で見失うまで表示を維持します。</p>
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
        <span>{found ? "マーカー形状を確認" : "マーカー検出待ち"}</span>
        <strong>{found ? "FOUND" : "—"}</strong>
      </div>
      <div className="debug-panel">
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
        <div className="eyebrow">OPTICAL MARKER SHAPE TEST</div>
        <h1>独自マーカー形状認識</h1>
        <p className="sub">黒い四角を探すのではなく、マーカー固有の形を確認します。</p>

        {mode === "select" && (
          <div className="role-grid">
            <button className="role-button" onClick={() => setMode("send")}>
              <span>送信側</span>
              <strong>模様を表示</strong>
              <small>形状認識用マーカー</small>
            </button>
            <button className="role-button" onClick={() => setMode("receive")}>
              <span>受信側</span>
              <strong>カメラで探す</strong>
              <small>形状を照合して判定</small>
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
