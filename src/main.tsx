import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

function AudioTestLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 1000,
          border: "1px solid #3b4d68",
          borderRadius: 14,
          padding: "12px 16px",
          color: "#e8eef7",
          background: "#121c2d",
          boxShadow: "0 12px 30px rgba(0,0,0,.35)",
          fontWeight: 700,
        }}
      >
        音通信テスト
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="音通信テスト"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            padding: 14,
            background: "rgba(3,7,14,.88)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              border: "1px solid #2b3b54",
              borderRadius: 20,
              background: "#07111f",
              boxShadow: "0 24px 80px rgba(0,0,0,.5)",
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="音通信テストを閉じる"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: 10,
                border: "1px solid #3b4d68",
                borderRadius: 12,
                padding: "9px 13px",
                color: "#f5f7fb",
                background: "rgba(7,17,31,.9)",
                fontWeight: 700,
              }}
            >
              閉じる
            </button>

            <iframe
              title="音通信テスト"
              src="./audio.html"
              allow="microphone"
              style={{
                width: "100%",
                height: "100%",
                border: 0,
                background: "#07111f",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AudioTestLauncher />
  </StrictMode>,
);
