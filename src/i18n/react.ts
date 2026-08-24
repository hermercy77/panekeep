import { useCallback, useEffect, useState } from "react";
import { getAppLanguage, initializeAppLanguage, setAppLanguage, subscribeAppLanguage } from "./store";
import { translate, type AppLanguage, type MessageKey } from "./catalog";

export function useI18n() {
  const [language, setLanguageState] = useState<AppLanguage>(getAppLanguage());
  useEffect(() => {
    void initializeAppLanguage().then(setLanguageState);
    return subscribeAppLanguage(setLanguageState);
  }, []);
  const t = useCallback((key: MessageKey, variables?: Record<string, string | number | undefined>) =>
    translate(language, key, variables), [language]);
  const setLanguage = useCallback((next: AppLanguage) => setAppLanguage(next), []);
  return { language, setLanguage, t };
}
