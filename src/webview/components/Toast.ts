export type ToastKind = 'info' | 'warning';

/** キャンバス下部に一時表示する通知（接続できない理由・元に戻す方法などのフィードバック用）。 */
export class Toast {
  public readonly element: HTMLElement;
  private hideTimer: number | undefined;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'nplot-toast';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
  }

  public show(message: string, kind: ToastKind = 'info', durationMs = 3600): void {
    this.element.textContent = message;
    this.element.dataset.kind = kind;
    this.element.classList.add('is-visible');
    if (this.hideTimer !== undefined) {
      window.clearTimeout(this.hideTimer);
    }
    this.hideTimer = window.setTimeout(() => {
      this.element.classList.remove('is-visible');
    }, durationMs);
  }
}
