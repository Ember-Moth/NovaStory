import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const LEAVE_BOTTOM_THRESHOLD_PX = 24;
const RESUME_AT_BOTTOM_THRESHOLD_PX = 2;

function getDistanceToBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
}

function shouldLeaveAutoFollow(viewport: HTMLElement) {
  return getDistanceToBottom(viewport) > LEAVE_BOTTOM_THRESHOLD_PX;
}

function shouldResumeAutoFollow(viewport: HTMLElement) {
  return getDistanceToBottom(viewport) <= RESUME_AT_BOTTOM_THRESHOLD_PX;
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
  const lastContentVersionRef = useRef(contentVersion);
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

    if (shouldAutoFollowRef.current) {
      if (shouldLeaveAutoFollow(viewport)) {
        updateShouldAutoFollow(false);
      }
      return;
    }

    if (shouldResumeAutoFollow(viewport)) {
      updateShouldAutoFollow(true);
    }
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
    const didContentChange = lastContentVersionRef.current !== contentVersion;
    lastContentVersionRef.current = contentVersion;

    if (!shouldAutoFollow || !didContentChange) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
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
