import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/andika/400.css";
import "@fontsource/andika/700.css";
import "@fontsource-variable/bitter";
import "./i18n";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
