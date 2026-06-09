import { flushSync } from "react-dom";
import type { AroundNavHandler } from "wouter";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** wouter navigation with View Transitions API + flushSync for synchronous DOM updates. */
export const aroundNavWithViewTransition: AroundNavHandler = (navigate, to, options) => {
  if (!document.startViewTransition || prefersReducedMotion()) {
    navigate(to, options);
    return;
  }

  document.startViewTransition(() => {
    flushSync(() => {
      navigate(to, options);
    });
  });
};
