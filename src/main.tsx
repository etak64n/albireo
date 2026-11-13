import "./styles.css";
// The theme comes after the base styles, so that its theme.css sets the variables that they read.
import appearance from "virtual:albireo-appearance";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// The logos of the themes are also the icon of the browser tab.
document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", appearance.favicon);

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no element with the ID root.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
