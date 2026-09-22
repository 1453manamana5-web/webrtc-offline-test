import { useEffect, useRef, useState } from "react";

const MARKER_SIZE = 7;
const MARKER = [
  [1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1],
  [1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1],
  [1,1,1,1,1,1,1],
];

function Marker() {
  return (
    <div className="marker-board">
      <div className="marker-grid">
        {MARKER.flatMap((row, y) => row.map((bit, x) => (
          <span key={`${x}-${y}`} className={bit ? "marker-cell on" : "marker-cell"} />
        )))}
      </div>
      <div className="marker-dot" />
    </div>
  );
}

function Sender() {
  return (
    <div className="optical-panel">
      <div className="mode-label">送信側</div>
      <h2>独自マーカー</h2>
      <p className="hint">受信側のカメラに、このマーカーを映します。まずは「見つける」だけをテストします。</p>
      <Marker />
      <div className="detect-marker">MARKER DETECTION TEST</div>
    </div>
  );
}

function Receiver() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
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

      // 画像全体を粗く2値化し、黒い領域の連結成分を探す。
      const block = 4;
      const w = size / block;
      const h = size / block;
      const gray = new Uint8Array(w * h);

      for (let by = 0; by < h; by++) {
        for (let bx = 0; bx < w; bx++) {
          let total = 0;
          for (let y = 0; y < block; y++) {
            for (let x = 0; x < block; x++) {
              const px = ((by * block + y) * size + bx * block + x) * 4;
              total += (data[px] + data[px + 1] + data[px + 2]) / 3;
            }
          }
          gray[by * w + bx] = total / (block * block);
        }
      }

      const values = Array.from(gray);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const threshold = min + (max - min) * 0.32;
      const dark = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) dark[i] = gray[i] < threshold ? 1 : 0;

      // 黒領域の連結成分。小さすぎるものは無視する。
      const seen = new Uint8Array(w * h);
      let bestScore = 0;
      let bestBox = "";
      let bestArea = 0;

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

          const neighbors = [p - 1, p + 1, p - w, p + w];
          for (const n of neighbors) {
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
        const fill = area / (bw * bh);
        const ratio = bw / bh;

        // 四角形に近い、十分大きな黒領域を候補にする。
        if (area >= 40 && bw >= 8 && bh >= 8 && ratio > 0.65 && ratio < 1.5 && fill > 0.35) {
          const score = Math.min(1, area / 1000) * Math.min(1, fill / 0.65);
          if (score > bestScore) {
            bestScore = score;
            bestArea = area;
            bestBox = `${minX},${minY} → ${maxX},${maxY}`;
          }
        }
      }

      const isFound = bestScore > 0.18 && bestArea >= 40;
      setFound(isFound);
      setInfo(isFound ? `候補発見 / 面積 ${bestArea} / ${bestBox}` : `探索中 / 明暗差 ${Math.round(max - min)}`);
    }

    frameRef.current = requestAnimationFrame(scan);
  };

  const start = async () => {
    try {
      setError("");
      setFound(false);
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
      <p className="hint">模様を中央に合わせる必要はありません。カメラ画像全体から候補を探します。</p>
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
        <span>{found ? "独自マーカー候補を発見" : "マーカー検出待ち"}</span>
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
        <div className="eyebrow">OPTICAL MARKER DETECTION TEST</div>
        <h1>独自マーカー検出</h1>
        <p className="sub">まずは画像の中から「認証模様そのもの」を発見できるか確認します。</p>

        {mode === "select" && (
          <div className="role-grid">
            <button className="role-button" onClick={() => setMode("send")}>
              <span>送信側</span>
              <strong>模様を表示</strong>
              <small>検出用の独自マーカー</small>
            </button>
            <button className="role-button" onClick={() => setMode("receive")}>
              <span>受信側</span>
              <strong>カメラで探す</strong>
              <small>画像全体から自動探索</small>
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
