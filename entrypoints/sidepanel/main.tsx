import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "../../src/ui/SidePanelApp";
import "../../src/ui/hallmark.css";

const root = document.getElementById("root");
if (!root) throw new Error("Tab Fridge sidepanel root is missing");

createRoot(root).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>
);
