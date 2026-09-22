import { useEffect, useRef, useState } from "react";

const GRID = 16;
const MAGIC = [0x4f, 0x50]; // "OP"
const PAYLOAD_BYTES = 27;

function makeFrame(text: string): number[] {
  const bytes = new TextEncoder().encode(text).slice(0, PAYLOAD_BYTES);
  const frame = new Array(GRID * GRID).fill(0);
  const packet: number[] = [...MAGIC, bytes.length, ...bytes];

  while (packet.length < 2 + 1 + PAYLOAD_BYTES) packet.push(0);

  let checksum = 0;
  for (const byte of bytes) checksum = (checksum + byte) & 0xff;
  packet.push(checksum);

  let bitIndex = 0;
  for (const byte of packet) {
    for (let bit = 7; bit >= 0; bit--) {
      frame[bitIndex++] = (byte >> bit) & 1;
    }
  }

  return frame;
}

function decodeFrame(frame: number[]): string | null {
  if (frame.length !== GRID * GRID) return null;

  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      byte = (byte << 1) | frame[i * 8 + bit];
    }
    bytes.push(byte);
  }

  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) return null;

  const length = bytes[2];
  if (length > PAYLOAD_BYTES) return null;

  let checksum = 0;
  for (let i = 0; i < length; i++) {
    checksum = (checksum + bytes[3 + i]) & 0xff;
  }
  if (checksum !== bytes[30]) return null;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes.slice(3, 3 + length)),
    );
  } catch {
    return null;
  }
}

function OpticalSender() {
  const [text, setText] = useState("HELLO");
  const [frame, setFrame] = useState(() => makeFrame("HELLO"));

  const update = () => setFrame(makeFrame(text));

  return (
    <div className="optical-panel">
      <div className="mode-label">送信側</div>
      <h2>画面を光通信パターンにする</h2>
      <p className="hint">受信側のiPadカメラを、この模様に向けます。</p>

      <div className="optical-frame" aria-label="光通信パターン">
        {frame.map((bit, i) => (
          <span key={i} className={bit ? "cell on" : "cell"} />
        ))}
      </div>

      <div className="input-row">
        <input
          value={text}
          maxLength={PAYLOAD_BYTES}
          onChange={(e) => setText(e.target.value)}
          placeholder="送信する文字"
        />
        <button className="primary" onClick={update}>更新</button>
      </div>

      <div className="packet-info">
        {new TextEncoder().encode(text).length} bytes / 最大 {PAYLOAD_BYTES} bytes
      </div>
    </div>
  );
}

function OpticalReceiver() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("カメラ待機中");
  const [error, setError] = useState("");
  const [debugBits, setDebugBits] = useState<number[]>(() => new Array(GRID * GRID).fill(0));
  const [debugRange, setDebugRange] = useState("—");

  const stopCamera = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;

    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }

    setRunning(false);
    setStatus("カメラ停止");
  };

  const scan = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      animationRef.current = requestAnimationFrame(scan);
      return;
    }

    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    // Map the on-screen 70% target square back into the actual camera frame.
    // This compensates for object-fit: cover cropping on iPad.
    const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
    const visibleWidth = displayWidth / scale;
    const visibleHeight = displayHeight / scale;
    const cropX = (sourceWidth - visibleWidth) / 2;
    const cropY = (sourceHeight - visibleHeight) / 2;

    const targetDisplaySize = Math.min(displayWidth, displayHeight) * 0.70;
    const targetX = (displayWidth - targetDisplaySize) / 2;
    const targetY = (displayHeight - targetDisplaySize) / 2;

    const sx = cropX + targetX / scale;
    const sy = cropY + targetY / scale;
    const size = targetDisplaySize / scale;

    const sampleSize = GRID * 16;
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (ctx) {
      ctx.drawImage(video, sx, sy, size, size, 0, 0, sampleSize, sampleSize);
      const image = ctx.getImageData(0, 0, sampleSize, sampleSize);

      const values: number[] = [];

      // Sample the central 60% of each cell, avoiding cell edges.
      const inset = 3;
      const cellSize = sampleSize / GRID;

      for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
          let total = 0;
          let count = 0;

          const startX = Math.floor(col * cellSize + inset);
          const endX = Math.ceil((col + 1) * cellSize - inset);
          const startY = Math.floor(row * cellSize + inset);
          const endY = Math.ceil((row + 1) * cellSize - inset);

          for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
              const index = (y * sampleSize + x) * 4;
              total += (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
              count++;
            }
          }

          values.push(count ? total / count : 128);
        }
      }

      const min = Math.min(...values);
      const max = Math.max(...values);
      const threshold = min + (max - min) * 0.5;
      const bits = values.map((value) => (value > threshold ? 1 : 0));

      setDebugBits(bits);
      setDebugRange(`${Math.round(min)} / ${Math.round(max)} / 閾値 ${Math.round(threshold)}`);

      const decoded = decodeFrame(bits);
      if (decoded !== null) {
        setResult(decoded);
        setStatus("受信成功");
      } else {
        setStatus(max - min < 35 ? "コントラスト不足" : "読み取り中…");
      }
    }

    animationRef.current = requestAnimationFrame(scan);
  };

  const startCamera = async () => {
    try {
      setError("");
      setResult("");
      setStatus("カメラ起動中…");

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
      setStatus("カメラ起動失敗");
    }
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <div className="optical-panel">
      <div className="mode-label">受信側</div>
      <h2>カメラで光通信パターンを読む</h2>
      <p className="hint">白い枠の中いっぱいに送信側の模様を合わせてください。</p>

      <div className="camera-wrap">
        <video ref={videoRef} muted playsInline />
        <div className="target-frame" />
        <div className="target-label">模様をこの枠いっぱいに</div>
      </div>

      <canvas ref={canvasRef} className="hidden-canvas" />

      {!running ? (
        <button className="primary" onClick={startCamera}>カメラを起動</button>
      ) : (
        <button className="secondary" onClick={stopCamera}>カメラを停止</button>
      )}

      <div className={result ? "receive-result success" : "receive-result"}>
        <span>{status}</span>
        <strong>{result || "—"}</strong>
      </div>

      <div className="debug-panel">
        <div className="debug-title">読み取りデバッグ</div>
        <div className="debug-grid" aria-label="カメラが読み取った16×16パターン">
          {debugBits.map((bit, i) => (
            <span key={i} className={bit ? "debug-cell on" : "debug-cell"} />
          ))}
        </div>
        <div className="debug-info">{debugRange}</div>
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
        <div className="eyebrow">OPTICAL COMMUNICATION TEST</div>
        <h1>光通信テスト</h1>
        <p className="sub">まずはiPadの画面とカメラだけで、短いデータを送れるか試します。</p>

        {mode === "select" && (
          <div className="role-grid">
            <button className="role-button" onClick={() => setMode("send")}>
              <span>送信</span>
              <strong>画面を表示</strong>
              <small>光通信パターンを表示する</small>
            </button>
            <button className="role-button" onClick={() => setMode("receive")}>
              <span>受信</span>
              <strong>カメラで読む</strong>
              <small>相手の画面を読み取る</small>
            </button>
          </div>
        )}

        {mode !== "select" && (
          <>
            {mode === "send" ? <OpticalSender /> : <OpticalReceiver />}
            <button className="reset" onClick={() => setMode("select")}>最初に戻る</button>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
