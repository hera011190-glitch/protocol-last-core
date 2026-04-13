import { useEffect, useMemo, useRef, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import { buildApiUrl } from "./api";

const LAST_AUTH_DELAY_KEY = "plc-last-auth-delay";

async function probeServer(signal) {
  try {
    const res = await fetch(buildApiUrl(`/health?t=${Date.now()}`), { cache: "no-store", signal });
    return res.ok;
  } catch {
    return false;
  }
}

function Login({ setUser, design, theme }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState("login");
  const [pending, setPending] = useState(false);
  const requestRef = useRef(0);
  const activeControllerRef = useRef(null);
  const rescueTimerRef = useRef(null);
  const mountedRef = useRef(true);

  const handlers = useMemo(
    () => ({
      goHome: () => {},
      openMy: () => {},
      goSD: () => {},
      goCharacters: () => {},
      goInvestigations: () => {},
      goShop: () => {},
    }),
    []
  );

  useEffect(() => () => {
    mountedRef.current = false;
    try {
      activeControllerRef.current?.abort();
    } catch {}
    try {
      window.clearTimeout(rescueTimerRef.current);
    } catch {}
  }, []);

  const submit = async () => {
    if (pending) return;
    const nextId = id.trim();
    const nextPw = pw.trim();

    if (!nextId || !nextPw) {
      alert("아이디와 비밀번호를 입력해주세요.");
      return;
    }

    const url = mode === "login" ? buildApiUrl("/login") : buildApiUrl("/register");
    const currentRequest = requestRef.current + 1;
    requestRef.current = currentRequest;

    try {
      activeControllerRef.current?.abort();
    } catch {}

    setPending(true);
    try { window.clearTimeout(rescueTimerRef.current); } catch {}
    rescueTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current || requestRef.current !== currentRequest) return;
      try { activeControllerRef.current?.abort(); } catch {}
      setPending(false);
      alert("로그인 응답이 오래 걸려 요청을 초기화했어요. 다시 한 번 눌러주세요.");
    }, 11000);

    const sendAuthRequest = async (attempt) => {
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), attempt === 0 ? 6500 : 8500);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: nextId,
            pw: nextPw,
            type: "owner",
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        return { res, data };
      } finally {
        window.clearTimeout(timeout);
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    };

    try {
      let result = null;
      let lastError = null;
      const hadRecentDelay = (() => {
        try {
          const raw = Number(sessionStorage.getItem(LAST_AUTH_DELAY_KEY) || 0);
          return raw > 0 && Date.now() - raw < 15000;
        } catch {
          return false;
        }
      })();
      if (hadRecentDelay) {
        const probeController = new AbortController();
        const probeTimer = window.setTimeout(() => probeController.abort(), 2200);
        try {
          await probeServer(probeController.signal);
        } catch {}
        window.clearTimeout(probeTimer);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          result = await sendAuthRequest(attempt);
          try { sessionStorage.removeItem(LAST_AUTH_DELAY_KEY); } catch {}
          break;
        } catch (error) {
          lastError = error;
          if (error?.name === "AbortError") {
            try { sessionStorage.setItem(LAST_AUTH_DELAY_KEY, String(Date.now())); } catch {}
          }
          if (error?.name !== "AbortError") break;
        }
      }
      if (!result) throw lastError || new Error("auth_request_failed");
      if (!mountedRef.current || requestRef.current !== currentRequest) return;

      const { res, data } = result;
      if (!res.ok) {
        alert(data.message || "서버 응답이 올바르지 않습니다. 다시 시도해주세요.");
        return;
      }

      if (mode === "login") {
        if (data.success && data.user) {
          localStorage.setItem("plc-user", JSON.stringify(data.user));
          setUser(data.user);
        } else {
          alert(data.message || "로그인 실패");
        }
      } else if (data.success) {
        alert("회원가입 완료");
        setMode("login");
        setId(nextId);
        setPw("");
      } else {
        alert(data.message || "회원가입 실패");
      }
    } catch (error) {
      console.error("login error", error);
      if (!mountedRef.current || requestRef.current !== currentRequest) return;
      if (error?.name === "AbortError") {
        try { sessionStorage.setItem(LAST_AUTH_DELAY_KEY, String(Date.now())); } catch {}
      }
      alert(error?.name === "AbortError" ? "로그인 응답이 지연되고 있습니다. 서버가 잠깐 다시 시작 중이거나 바쁜 상태일 수 있어요. 잠시 후 다시 눌러주세요." : "서버 연결에 실패했습니다. 서버가 켜져 있는지 확인해주세요.");
    } finally {
      try { window.clearTimeout(rescueTimerRef.current); } catch {}
      if (mountedRef.current && requestRef.current === currentRequest) {
        setPending(false);
      }
    }
  };

  return (
    <DesignPageFrame
      design={design}
      pageKey="login"
      handlers={handlers}
      theme={theme}
      minHeight="100vh"
      innerStyle={{ borderRadius: 0, border: "none" }}
      contentStyle={{
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{
          width: "460px",
          maxWidth: "100%",
          padding: "28px",
          borderRadius: "28px",
          background: "linear-gradient(180deg, rgba(9,16,31,0.96), rgba(14,24,43,0.96))",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.34)",
          color: "white",
          backdropFilter: "blur(18px)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            fontSize: "30px",
            fontWeight: 900,
            letterSpacing: "0.08em",
            marginBottom: "10px",
          }}
        >
          PROTOCOL: LAST CORE
        </div>

        <div
          style={{
            textAlign: "center",
            fontSize: "12px",
            letterSpacing: "0.22em",
            color: "#7dd3fc",
            marginBottom: "22px",
          }}
        >
          {mode === "login" ? "LOGIN" : "REGISTER"}
        </div>

        <div style={{ display: "grid", gap: "12px" }}>
          <input
            placeholder="아이디"
            value={id}
            onChange={(e) => setId(e.target.value)}
            style={inputStyle}
          />

          <input
            placeholder="비밀번호"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            style={inputStyle}
          />

          <button type="submit" disabled={pending} style={{ ...primaryButtonStyle, opacity: pending ? 0.65 : 1, cursor: pending ? "wait" : "pointer" }}>
            {pending ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            style={{ ...ghostButtonStyle, opacity: pending ? 0.7 : 1 }}
          >
            {mode === "login" ? "회원가입으로 전환" : "로그인으로 전환"}
          </button>
        </div>
      </form>
    </DesignPageFrame>
  );
}

const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  outline: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "none",
  background: "#dbeafe",
  color: "#0f172a",
  fontWeight: 800,
  cursor: "pointer",
};

const ghostButtonStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#dbeafe",
  fontWeight: 700,
  cursor: "pointer",
};

export default Login;
