import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";

import { App } from "./App";

const elem = document.getElementById("root")!;
const root = createRoot(elem);

root.render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
