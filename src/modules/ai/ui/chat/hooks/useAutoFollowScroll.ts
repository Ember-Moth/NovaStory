import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 24;

function isViewportNearBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= BOTTOM_THRESHOLD_PX;
}

function scrollViewportToBottom(viewport: HTMLElement, behavior: ScrollBehavior | "instant") {
  viewport.scrollTo({
    top: viewport.scrollHeight,
    behavior,
  });
}

export function useAutoFollowScroll(sessionKey: string, contentVersion: string) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoFollowRef = useRef(true);
  const [shouldAutoFollow, setShouldAutoFollow] = useState(true);

  const updateShouldAutoFollow = useCallback((next: boolean) => {
    shouldAutoFollowRef.current = next;
    setShouldAutoFollow((current) => (current === next ? current : next));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior | "instant" = "instant") => {
    const viewport = viewportRef.current;
    if (viewport == null) {
      return;
    }
    scrollViewportToBottom(viewport, behavior);
  }, []);

  const resumeAutoFollow = useCallback(() => {
    updateShouldAutoFollow(true);
    scrollToBottom("smooth");
  }, [scrollToBottom, updateShouldAutoFollow]);

  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport == null) {
      return;
    }
    updateShouldAutoFollow(isViewportNearBottom(viewport));
  }, [updateShouldAutoFollow]);

  useEffect(() => {
    updateShouldAutoFollow(true);
  }, [sessionKey, updateShouldAutoFollow]);

  useLayoutEffect(() => {
    let frameId = 0;
    let cancelled = false;

    const scrollToBottomWhenReady = (attempt: number) => {
      if (cancelled) {
        return;
      }

      const viewport = viewportRef.current;
      if (viewport != null) {
        frameId = requestAnimationFrame(() => {
          scrollViewportToBottom(viewport, "instant");
        });
        return;
      }

      if (attempt >= 8) {
        return;
      }

      frameId = requestAnimationFrame(() => {
        scrollToBottomWhenReady(attempt + 1);
      });
    };

    scrollToBottomWhenReady(0);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [sessionKey]);

  useEffect(() => {
    if (!shouldAutoFollow) {
      return;
    }

    let frameId = requestAnimationFrame(() => {
      scrollToBottom("instant");
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [contentVersion, scrollToBottom, shouldAutoFollow]);

  useEffect(() => {
    const content = contentRef.current;
    if (content == null || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!shouldAutoFollowRef.current) {
        return;
      }
      scrollToBottom("instant");
    });

    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, [scrollToBottom, sessionKey]);

  return {
    viewportRef,
    contentRef,
    shouldAutoFollow,
    handleViewportScroll,
    resumeAutoFollow,
  };
}
