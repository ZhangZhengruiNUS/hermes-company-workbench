// SSE 单例 transport + 轮询降级 — 语义与旧版一致
import { useEffect, useRef, useState, useCallback } from "react";

export type LiveState = "live" | "polling" | "reconnecting" | "error";

const SSE_PATH = "/api/v1/stream";
const POLL_MS = 5000;
const MAX_RETRY = 5;

// 同源绝对 URL (SSE 亦然)
const sseUrl = () => window.location.origin + SSE_PATH;

export function useLiveFeed(onData: () => void) {
  const [state, setState] = useState<LiveState>("reconnecting");
  const [lastSnap, setLastSnap] = useState<Date | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    setState((s) => (s === "live" ? "polling" : s));
    pollRef.current = setInterval(() => {
      onDataRef.current();
      setLastSnap(new Date());
    }, POLL_MS);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource(sseUrl());
      esRef.current = es;

      es.onopen = () => {
        retryRef.current = 0;
        stopPolling();
        setState("live");
      };
      es.onmessage = () => {
        onDataRef.current();
        setLastSnap(new Date());
      };
      es.onerror = () => {
        es?.close();
        esRef.current = null;
        if (closed) return;
        retryRef.current += 1;
        if (retryRef.current <= MAX_RETRY) {
          setState("reconnecting");
          // 指数退避重连
          setTimeout(connect, Math.min(1000 * 2 ** retryRef.current, 15000));
          startPolling(); // 重连期间降级轮询
        } else {
          setState("error");
          startPolling();
        }
      };
    };
    connect();

    const onVis = () => {
      // 页面隐藏时暂停环境刷新由浏览器自行处理; 恢复时立即拉一次
      if (document.visibilityState === "visible") onDataRef.current();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      closed = true;
      es?.close();
      stopPolling();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [startPolling, stopPolling]);

  return { liveState: state, lastSnap };
}
