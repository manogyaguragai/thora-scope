// Controller over the loading-screen markup in index.html (§6.9). Plain DOM, no framework (ADR-007).
import { config } from '../core/config';
import { tips } from '../content/tips';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const root = el('loading');
const lens = el('load-lens');
const ring = document.getElementById('load-ring') as SVGCircleElement | null;
const stage = el('load-stage');
const tip = el('load-tip');
const errorCard = el('load-error');
const errorMsg = el('load-error-msg');
const retry = el<HTMLButtonElement>('load-retry');
const lowQuality = el<HTMLButtonElement>('load-low');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

root.style.setProperty('--iris-ms', `${config.loading.irisMs}ms`);

let tipIndex = Math.floor(Math.random() * tips.length);
tip.textContent = tips[tipIndex] ?? '';
const tipTimer = setInterval(() => {
  const next = (): void => {
    tipIndex = (tipIndex + 1) % tips.length;
    tip.textContent = tips[tipIndex] ?? '';
    tip.style.opacity = '1';
  };
  if (reduceMotion.matches) {
    next();
  } else {
    tip.style.opacity = '0';
    setTimeout(next, config.loading.tipFadeMs);
  }
}, config.loading.tipMs);

let shownPct = -1;

/** Stage line, e.g. "Downloading model · 34%". A non-finite fraction shows the name only. */
export function setStage(name: string, fraction: number): void {
  stage.textContent = Number.isFinite(fraction)
    ? `${name} · ${Math.round(Math.min(1, fraction) * 100)}%`
    : name;
}

/** Ring fill, 0…1 across all stages. DOM is touched only when the whole percent changes. */
export function setOverall(fraction: number): void {
  if (!Number.isFinite(fraction)) return;
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  if (pct === shownPct) return;
  shownPct = pct;
  ring?.style.setProperty('stroke-dashoffset', String(100 - pct));
  lens.setAttribute('aria-valuenow', String(pct));
}

export interface ErrorActions {
  onRetry: () => void;
  onLowQuality: () => void;
}

export function showError(message: string, actions: ErrorActions): void {
  clearInterval(tipTimer);
  root.classList.add('failed');
  stage.textContent = 'Load failed';
  errorMsg.textContent = message;
  retry.onclick = actions.onRetry;
  lowQuality.onclick = actions.onLowQuality;
  errorCard.hidden = false;
  retry.focus();
}

/** Iris the lens open and remove the screen. Instant under prefers-reduced-motion. */
export function irisOpen(): Promise<void> {
  clearInterval(tipTimer);
  if (reduceMotion.matches) {
    root.remove();
    return Promise.resolve();
  }
  root.classList.add('open');
  return new Promise((resolve) =>
    setTimeout(() => {
      root.remove();
      resolve();
    }, config.loading.irisMs),
  );
}
