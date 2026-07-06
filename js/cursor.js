// Cursor custom: una mano (iconos Lucide) que sigue al puntero.
// - mano abierta por defecto
// - dedo señalando al pasar sobre una carta (con un pequeño pulso)
// - mano agarrando mientras se mantiene pulsado
// En pantallas táctiles no se activa (no hay puntero).
import { icon } from './icons.js?v=6';

export function initCursor() {
  if (matchMedia('(pointer: coarse)').matches) return; // táctil: cursor nativo

  document.documentElement.style.cursor = 'none';
  document.body.style.cursor = 'none';

  const el = document.createElement('div');
  el.id = 'cursor';
  el.style.cssText = `
    position: fixed; left: 0; top: 0; z-index: 99; pointer-events: none;
    width: 30px; height: 30px; color: #f1f5f9; display: none;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,.65));
    transition: transform .12s ease-out;
    transform-origin: 30% 20%;
  `;
  document.body.appendChild(el);

  const shapes = {
    hand: icon('hand', 30, 2),
    pointer: icon('pointer', 30, 2),
    grab: icon('grab', 30, 2),
  };
  let shape = '';
  function setShape(name, scale = 1) {
    if (shape !== name) { shape = name; el.innerHTML = shapes[name]; }
    el.style.transform = `scale(${scale})`;
  }
  setShape('hand');

  let overCard = false, down = false;
  function refresh() {
    if (down) setShape('grab', 0.92);
    else if (overCard) setShape('pointer', 1.18); // reacción al pasar por una carta
    else setShape('hand', 1);
  }

  addEventListener('pointermove', (ev) => {
    el.style.display = 'block';
    el.style.left = `${ev.clientX - 9}px`;
    el.style.top = `${ev.clientY - 6}px`;
    const nowOver = !!ev.target.closest?.('.card, button');
    if (nowOver !== overCard) { overCard = nowOver; refresh(); }
  }, { passive: true });
  addEventListener('pointerdown', () => { down = true; refresh(); });
  addEventListener('pointerup', () => { down = false; refresh(); });
  document.addEventListener('mouseleave', () => { el.style.display = 'none'; });
}
