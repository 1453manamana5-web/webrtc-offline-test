import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Html5Qrcode } from "html5-qrcode";

type Role = "host" | "join";
type SignalType = "offer" | "answer";

type SignalPayload = {
  type: SignalType;
  sdp: RTCSessionDescriptionInit;
};

const ICE_SERVERS: RTCConfiguration = { iceServers: [] };

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    window.setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 8000);
  });
}

async function encodeSignal(payload: SignalPayload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  ).arrayBuffer();

  const binary = String.fromCharCode(...new Uint8Array(compressed));
  return btoa(binary);
}

async function decodeSignal(value: string): Promise<SignalPayload> {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const decompressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  ).arrayBuffer();

  return JSON.parse(new TextDecoder().decode(decompressed)) as SignalPayload;
}

function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [signal, setSignal] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [received, setReceived] = useState<string[]>([]);
  const [status, setStatus] = useState("待機中");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const cleanup = useCallback(() => {
    scannerRef.current?.stop().catch(() => {});
    scannerRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const setupChannel = useCallback((channel: RTCDataChannel) => {
    channelRef.current = channel;
    channel.onopen = () => {
      setConnected(true);
      setStatus("接続済み");
      setError("");
    };
    channel.onclose = () => {
      setConnected(false);
      setStatus("切断");
    };
    channel.onerror = () => setError("DataChannelでエラーが発生しました。");
    channel.onmessage = (event) => {
      setReceived((prev) => [...prev, String(event.data)]);
    };
  }, []);

  const createPeer = useCallback(() => {
    cleanup();
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed") {
        setStatus("接続失敗");
        setError("WebRTCの接続に失敗しました。");
      } else if (state === "disconnected") {
        setStatus("切断");
      }
    };
    return pc;
  }, [cleanup]);

  const createOffer = async () => {
    try {
      setError("");
      setStatus("Offer作成中...");
      const pc = createPeer();
      const channel = pc.createDataChannel("test");
      setupChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      const local = pc.localDescription;
      if (!local) throw new Error("Offerを取得できませんでした。");
      const encoded = await encodeSignal({ type: "offer", sdp: local });
      setSignal(encoded);
      setStatus("Offer準備完了。Bで読み取ってください。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Offer作成に失敗しました。");
      setStatus("エラー");
    }
  };

  const acceptOfferAndCreateAnswer = async (encodedOffer: string) => {
    try {
      setError("");
      setStatus("Answer作成中...");
      const offer = await decodeSignal(encodedOffer);
      if (offer.type !== "offer") throw new Error("Offerではありません。");
      const pc = createPeer();
      pc.ondatachannel = (event) => setupChannel(event.channel);
      await pc.setRemoteDescription(offer.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);
      const local = pc.localDescription;
      if (!local) throw new Error("Answerを取得できませんでした。");
      const encoded = await encodeSignal({ type: "answer", sdp: local });
      setSignal(encoded);
      setStatus("Answer準備完了。Aで読み取ってください。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Answer作成に失敗しました。");
      setStatus("エラー");
    }
  };

  const acceptAnswer = async (encodedAnswer: string) => {
    try {
      setError("");
      setStatus("Answer適用中...");
      const answer = await decodeSignal(encodedAnswer);
      if (answer.type !== "answer") throw new Error("Answerではありません。");
      const pc = pcRef.current;
      if (!pc) throw new Error("先にOfferを作成してください。");
      await pc.setRemoteDescription(answer.sdp);
      setStatus("接続待機中...");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Answerの適用に失敗しました。");
      setStatus("エラー");
    }
  };

  const startScanner = async () => {
    try {
      setError("");
      setScannerOpen(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 20,
          qrbox: { width: 360, height: 360 },
        },
        async (decodedText) => {
          await scanner.stop().catch(() => {});
          scannerRef.current = null;
          setScannerOpen(false);
          if (role === "join") {
            await acceptOfferAndCreateAnswer(decodedText);
          } else {
            await acceptAnswer(decodedText);
          }
        },
        () => {},
      );
    } catch (e) {
      setScannerOpen(false);
      setError(e instanceof Error ? e.message : "カメラを起動できませんでした。");
    }
  };

  const sendMessage = () => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open" || !message.trim()) return;
    channel.send(message);
    setReceived((prev) => [...prev, `自分: ${message}`]);
    setMessage("");
  };

  const reset = () => {
    cleanup();
    setSignal("");
    setConnected(false);
    setReceived([]);
    setStatus("待機中");
    setError("");
    setRole(null);
  };

  return (
    <main className="app">
      <section className="card">
        <div className="eyebrow">WEBRTC / OFFLINE TEST</div>
        <h1>端末間通信テスト</h1>
        <p className="sub">まずは2台の端末を直接つなぐ実験です。</p>

        {!role ? (
          <div className="role-grid">
            <button className="role-button" onClick={() => setRole("host")}>
              <span>A</span>
              <strong>Host</strong>
              <small>Offerを作成する端末</small>
            </button>
            <button className="role-button" onClick={() => setRole("join")}>
              <span>B</span>
              <strong>Join</strong>
              <small>Offerを読み取る端末</small>
            </button>
          </div>
        ) : (
          <>
            <div className="topbar">
              <span>{role === "host" ? "A / Host" : "B / Join"}</span>
              <span className={connected ? "online" : "waiting"}>{status}</span>
            </div>

            {role === "host" && !signal && (
              <button className="primary" onClick={createOffer}>① Offerを作成</button>
            )}

            {signal && (
              <div className="signal-card">
                <h2>{signal.startsWith("ey") ? (role === "host" ? "AのOffer" : "BのAnswer") : "接続情報"}</h2>
                <p>もう一方の端末でこのQRを読み取ります。</p>
                <div className="qr">
                  <QRCodeSVG value={signal} size={360} level="L" includeMargin />
                </div>
                <div className="signal-size">{signal.length.toLocaleString()} characters · compressed signaling</div>
              </div>
            )}

            {role === "join" && !signal && (
              <button className="primary" onClick={startScanner}>① AのOfferを読み取る</button>
            )}

            {role === "host" && signal && !connected && (
              <button className="secondary" onClick={startScanner}>② BのAnswerを読み取る</button>
            )}

            {role === "join" && signal && !connected && (
              <button className="secondary" onClick={startScanner}>② AのOfferをもう一度読み取る</button>
            )}

            {connected && (
              <div className="chat">
                <h2>DataChannel通信</h2>
                <div className="messages">
                  {received.length === 0 ? <span className="muted">まだメッセージはありません。</span> : received.map((item, i) => <div key={i}>{item}</div>)}
                </div>
                <div className="send-row">
                  <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="メッセージ" onKeyDown={(e) => e.key === "Enter" && sendMessage()} />
                  <button onClick={sendMessage}>送信</button>
                </div>
              </div>
            )}

            <button className="reset" onClick={reset}>最初からやり直す</button>
          </>
        )}

        {scannerOpen && (
          <div className="scanner-overlay">
            <div className="scanner-panel">
              <div className="scanner-head">
                <strong>QRを読み取る</strong>
                <button onClick={() => { scannerRef.current?.stop().catch(() => {}); scannerRef.current = null; setScannerOpen(false); }}>閉じる</button>
              </div>
              <div id="qr-reader" />
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
      </section>
    </main>
  );
}

export default App;