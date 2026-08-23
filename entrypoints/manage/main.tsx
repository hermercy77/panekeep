import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ManageApp } from "../../src/ui/ManageApp";
import "../../src/ui/hallmark.css";

const root = document.getElementById("root");
if (!root) throw new Error("Tab Fridge manage root is missing");

createRoot(root).render(
  <StrictMode>
    <ManageApp />
  </StrictMode>
);
