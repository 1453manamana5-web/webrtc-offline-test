import { useEffect, useRef, useState } from "react";

const PATTERN = [
  1,0,1,1,0,0,1,0,
  0,1,0,0,1,1,0,1,
  1,1,0,1,0,1,0,0,
  0,0,1,0,1,0,1,1,
  1,0,0,1,1,0,1,0,
  0,1,1,0,0,1,0,1,
  1,0,1,0,1,1,0,0,
  0,1,0,1,0,0,1,1,
];

function DetectionSender() {
  return (
    <div className="optical-panel">
      <div className="mode-label">送信側</div>
      <h2>検出テスト用パターン</h2>
      <p className="hint">受信側のカメラに、この模様を映します。</p>
      <div className="detect-frame" aria-label="検出テストパターン">
        {PATTERN.map((bit, i) => (
          <span key={i} className={bit ? "detect-cell on" : "detect-cell"} />
        ))}
      </div>
      <div className="detect-marker">TEST PATTERN</div>
    </div>
  );
}

function DetectionReceiver() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [detected, setDetected] = useState(false);
  const [range, setRange] = useState("—");
  const [error, setError] = useState("");

  const stopCamera = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    setRunning(false);
  };

  const scan = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      animationRef.current = requestAnimationFrame(scan);
      return;
    }

    const canvas = document.createElement("canvas");
    const size = 240;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (ctx) {
      const sourceSize = Math.min(video.videoWidth, video.videoHeight);
      const sx = (video.videoWidth - sourceSize) / 2;
      const sy = (video.videoHeight - sourceSize) / 2;
      ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      const values: number[] = [];
      const cell = size / 8;

      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          let total = 0;
          let count = 0;
          const inset = 5;
          for (let y = Math.floor(row * cell + inset); y < Math.ceil((row + 1) * cell - inset); y++) {
            for (let x = Math.floor(col * cell + inset); x < Math.ceil((col + 1) * cell - inset); x++) {
              const i = (y * size + x) * 4;
              total += (data[i] + data[i + 1] + data[i + 2]) / 3;
              count++;
            }
          }
          values.push(total / count);
        }
      }

      const min = Math.min(...values);
      const max = Math.max(...values);
      const threshold = min + (max - min) * 0.5;
      const bits = values.map((v) => (v > threshold ? 1 : 0));

      let matches = 0;
      for (let i = 0; i < PATTERN.length; i++) {
        if (bits[i] === PATTERN[i]) matches++;
      }

      const score = matches / PATTERN.length;
      setDetected(score >= 0.88);
      setRange("一致率 " + Math.round(score * 100) + "% / 明暗差 " + Math.round(max - min));
    }

    animationRef.current = requestAnimationFrame(scan);
  };

  const startCamera = async () => {
    try {
      setError("");
      setDetected(false);
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
      animationRef.current = requestAnimationFrame(scan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "カメラを起動できませんでした。");
    }
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <div className="optical-panel">
      <div className="mode-label">受信側</div>
      <h2>カメラで模様を検出</h2>
      <p className="hint">送信側の8×8模様を画面中央に合わせます。</p>
      <div className="camera-wrap">
        <video ref={videoRef} muted playsInline />
        <div className="target-frame detect-target" />
        <div className="target-label">模様を枠の中へ</div>
      </div>
      {!running ? (
        <button className="primary" onClick={startCamera}>カメラを起動</button>
      ) : (
        <button className="secondary" onClick={stopCamera}>カメラを停止</button>
      )}
      <div className={detected ? "receive-result success" : "receive-result"}>
        <span>{detected ? "パターン検出" : "検出待ち"}</span>
        <strong>{detected ? "OK" : "—"}</strong>
      </div>
      <div className="debug-panel">
        <div className="debug-title">検出情報</div>
        <div className="debug-info">{range}</div>
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
        <div className="eyebrow">OPTICAL PATTERN DETECTION TEST</div>
        <h1>模様検出テスト</h1>
        <p className="sub">まずはカメラだけで、決めた模様を認識できるか確認します。</p>

        {mode === "select" && (
          <div className="role-grid">
            <button className="role-button" onClick={() => setMode("send")}>
              <span>送信</span>
              <strong>模様を表示</strong>
              <small>検出テスト用の固定パターン</small>
            </button>
            <button className="role-button" onClick={() => setMode("receive")}>
              <span>受信</span>
              <strong>カメラで検出</strong>
              <small>模様が映ったら自動判定</small>
            </button>
          </div>
        )}

        {mode !== "select" && (
          <>
            {mode === "send" ? <DetectionSender /> : <DetectionReceiver />}
            <button className="reset" onClick={() => setMode("select")}>最初に戻る</button>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
