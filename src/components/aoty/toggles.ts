// Open/close buttons for list breakdowns and publication top 10s (aria-controls).
export function wireToggles(root: ParentNode = document) {
  root.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('button.open-btn[aria-controls]');
    if (!btn) return;
    const panel = document.getElementById(btn.getAttribute('aria-controls')!);
    if (!panel) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  });
}
