import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ManageApp } from "../../src/ui/ManageApp";
import "../../src/ui/hallmark.css";
import { initializeAppLanguage } from "../../src/i18n";

const root = document.getElementById("root");
if (!root) throw new Error("PaneKeep manage root is missing");

void initializeAppLanguage().then(() => {
  createRoot(root).render(
    <StrictMode>
      <ManageApp />
    </StrictMode>
  );
});
