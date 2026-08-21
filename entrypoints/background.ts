import { defineBackground } from "wxt/utils/define-background";
import { startBackground } from "../src/background/serviceWorker";

export default defineBackground(() => {
  void startBackground();
});

