import './ui/styles.css';
import { App } from './App';
import { audio } from './core/Audio';
import { ControllerApp } from './input/ControllerApp';

const params = new URLSearchParams(location.search);
const room = params.get('room');

if (room && /^[A-Z]{4}$/i.test(room)) {
  // Phone scanned the QR code: run the lightweight motion-controller UI only.
  document.getElementById('boot-screen')?.remove();
  (document.getElementById('game-canvas') as HTMLCanvasElement).style.display = 'none';
  new ControllerApp(document.getElementById('ui-root') as HTMLElement, room.toUpperCase()).mount();
} else {
  const app = new App();
  if (import.meta.env.DEV) {
    // Dev-only hook for automated playtests (step frames while the tab is backgrounded).
    (window as unknown as { __escape: App; __audio: typeof audio }).__escape = app;
    (window as unknown as { __audio: typeof audio }).__audio = audio;
  }
  app.boot().catch((err: unknown) => {
    console.error(err);
    const status = document.getElementById('boot-status');
    if (status) status.textContent = `Boot failed: ${err instanceof Error ? err.message : String(err)}`;
  });
}
