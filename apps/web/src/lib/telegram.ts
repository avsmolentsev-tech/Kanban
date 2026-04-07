/** Telegram Web App helpers */

export function isTelegramWebApp(): boolean {
  try {
    return !!(window as any).Telegram?.WebApp?.initData;
  } catch {
    return false;
  }
}

export function getTelegramWebApp() {
  return (window as any).Telegram?.WebApp;
}

export function initTelegramApp(): void {
  const tg = getTelegramWebApp();
  if (!tg) return;

  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();

  // Apply Telegram theme
  const root = document.documentElement;
  if (tg.themeParams) {
    const t = tg.themeParams;
    if (t.bg_color) root.style.setProperty('--tg-bg', t.bg_color);
    if (t.text_color) root.style.setProperty('--tg-text', t.text_color);
    if (t.hint_color) root.style.setProperty('--tg-hint', t.hint_color);
    if (t.button_color) root.style.setProperty('--tg-button', t.button_color);
    if (t.button_text_color) root.style.setProperty('--tg-button-text', t.button_text_color);
    if (t.secondary_bg_color) root.style.setProperty('--tg-secondary-bg', t.secondary_bg_color);
  }

  // Set viewport height CSS variable (Telegram WebView quirk)
  const setVh = () => {
    root.style.setProperty('--tg-vh', `${tg.viewportStableHeight}px`);
  };
  tg.onEvent('viewportChanged', setVh);
  setVh();
}
