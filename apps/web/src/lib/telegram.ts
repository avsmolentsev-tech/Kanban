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

/**
 * Нативная кнопка «назад» в шапке Telegram.
 *
 * Панели (встреча, транскрипт, задача…) открываются поверх приложения, и внутри
 * Telegram единственным способом выйти оставался маленький серый «×» — его не
 * находят и закрывают всё приложение целиком. Кнопка «назад» — штатный для
 * Telegram способ, она же ловит системный жест «назад» на Android.
 *
 * Обработчики держим стопкой: панели вкладываются друг в друга (встреча внутри
 * проекта), и «назад» должен закрывать верхнюю, а не все сразу.
 */
type BackHandler = () => void;
const backStack: BackHandler[] = [];
let backClickWired = false;

function runTopBackHandler(): void {
  const top = backStack[backStack.length - 1];
  if (top) top();
}

function syncBackButton(): void {
  const bb = getTelegramWebApp()?.BackButton;
  if (!bb || typeof bb.show !== 'function' || typeof bb.hide !== 'function') return;

  if (backStack.length > 0) {
    if (!backClickWired && typeof bb.onClick === 'function') {
      bb.onClick(runTopBackHandler);
      backClickWired = true;
    }
    bb.show();
  } else {
    bb.hide();
  }
}

/**
 * Показывает кнопку «назад», пока панель открыта.
 * Возвращает функцию снятия — её достаточно вернуть из useEffect.
 * Вне Telegram не делает ничего.
 */
export function pushBackHandler(handler: BackHandler): () => void {
  if (!isTelegramWebApp()) return () => {};

  backStack.push(handler);
  syncBackButton();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = backStack.lastIndexOf(handler);
    if (i !== -1) backStack.splice(i, 1);
    syncBackButton();
  };
}

export function initTelegramApp(): void {
  const tg = getTelegramWebApp();
  if (!tg) return;

  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();

  // Bot API 7.7+: не даём Telegram утаскивать окно вниз, когда листаешь длинный
  // текст внутри приложения — иначе транскрипт невозможно прокрутить, не придерживая
  // окно пальцем. На старых клиентах метода просто нет, поведение остаётся прежним.
  if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();

  // Кнопка «назад» прячется, пока ни одна панель не открыта.
  syncBackButton();

  // Apply body position:fixed only in Telegram/mobile context
  // (prevents iOS keyboard viewport push, but causes horizontal
  // shift on desktop due to scrollbar width interactions)
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';

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
