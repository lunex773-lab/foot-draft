/**
 * The game screen cannot be zoomed (user request, 2026-11-17).
 *
 * - the viewport meta tag forbids scaling (Android Chrome and most browsers)
 * - iOS Safari ignores that for pinch gestures, so the gesture events are cancelled
 * - double-tap zoom is turned off by `touch-action: manipulation` (styles.css)
 * - text fields use 16px text so iOS does not zoom in when they get focus (styles.css)
 * - on computers, Ctrl / Cmd + wheel (trackpad pinch) and Ctrl / Cmd + "+", "-", "0" are cancelled
 */
const stop = (e: Event) => e.preventDefault();

for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(name, stop, { passive: false });
}

// two-finger moves (pinch) on browsers without gesture events
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', ';'].includes(e.key)) e.preventDefault();
});

export {};
