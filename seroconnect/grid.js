/* Клавиша G (П) и ключ ?сетка в адресе показывают сетку.
   Внутри склейки кадр сам ничего не рисует, а просит склейку: её
   наложение одно на всю страницу и не рвётся на стыках кадров. */
(() => {
  const вКадре = window.parent !== window;
  const root = document.documentElement;
  function переключить(){ root.classList.toggle('сетка'); }
  if (!вКадре){
    const над = document.createElement('div');
    над.className = 'сетка-над';
    над.innerHTML = '<i></i>'.repeat(12);
    (document.body || root).appendChild(над);
    if (new URLSearchParams(location.search).has('сетка')) переключить();
    addEventListener('message', e => { if (e.data === 'сетка') переключить(); });
  }
  addEventListener('keydown', e => {
    if (!e.isTrusted || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'g' && k !== 'п') return;
    if (вКадре) parent.postMessage('сетка', '*'); else переключить();
  });
})();
