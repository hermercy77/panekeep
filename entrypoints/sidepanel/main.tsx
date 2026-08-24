import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "../../src/ui/SidePanelApp";
import "../../src/ui/hallmark.css";
import { initializeAppLanguage } from "../../src/i18n";

const root = document.getElementById("root");
if (!root) throw new Error("Tab Fridge sidepanel root is missing");

void initializeAppLanguage().then(() => {
  createRoot(root).render(
    <StrictMode>
      <SidePanelApp />
    </StrictMode>
  );
});
