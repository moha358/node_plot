/**
 * 要素の中身を一時的に1行入力欄へ置き換えるインライン編集。
 * Enter / フォーカス喪失で確定、Escape で取り消し。値が変わらなければ onCommit は呼ばない。
 */
export function startInlineEdit(
  host: HTMLElement,
  initialValue: string,
  onCommit: (nextValue: string) => void
): void {
  if (host.querySelector('.nplot-inline-input')) {
    return;
  }
  const previousText = host.textContent ?? '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nplot-input nplot-inline-input';
  input.value = initialValue;

  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) {
      return;
    }
    finished = true;
    const next = input.value.trim();
    host.textContent = commit && next ? next : previousText;
    if (commit && next && next !== initialValue) {
      onCommit(next);
    }
  };

  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));

  host.textContent = '';
  host.appendChild(input);
  input.focus();
  input.select();
}
