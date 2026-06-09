import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";

import { aroundNavWithViewTransition } from "@/app/navigation/viewTransitions";

import { App } from "./App";

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <Router aroundNav={aroundNavWithViewTransition}>
      <App />
    </Router>
  </StrictMode>
);

(import.meta.hot.data.root ??= createRoot(elem)).render(app);
