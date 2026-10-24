// Hand-made SVG illustrations (no emoji, nothing to download). Each returns an <svg> string.
(function (g) {
  const svg = (body, label, defs) => `<svg viewBox="0 0 120 120" class="art" role="img" aria-label="${label}"><defs>${defs || ''}</defs>${body}</svg>`;
  const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const ITEMS = {
    A: () => svg(`<ellipse cx="60" cy="96" rx="44" ry="6" fill="#000" opacity=".12"/>
      <path d="M14 78c0-14 8-24 18-26l18-14c4-3 9-2 12 2l8 10c8 6 22 8 30 12 6 3 8 9 8 16H14z" fill="url(#shA)"/>
      <path d="M14 78h94v8c0 3-2 5-5 5H19c-3 0-5-2-5-5z" fill="#FFF6E9"/><path d="M14 86h94" stroke="#16131F" stroke-width="2" opacity=".25"/>
      <path d="M50 40l6 7M55 36l6 7M60 33l6 7" stroke="#FFF6E9" stroke-width="3" stroke-linecap="round"/>
      <path d="M70 62c10 2 20 4 28 9" stroke="#FFF6E9" stroke-width="4" stroke-linecap="round" fill="none" opacity=".8"/>`, 'Running shoe', grad('shA', '#FF7A45', '#FF4D2E')),
    B: () => svg(`<ellipse cx="60" cy="106" rx="34" ry="5" fill="#000" opacity=".12"/>
      <path d="M44 14h32l10 6 20 22-12 10-8-8v60H34V44l-8 8-12-10 20-22z" fill="url(#kuB)"/>
      <path d="M52 14c2 8 14 8 16 0" fill="none" stroke="#FFF6E9" stroke-width="3"/><path d="M60 20v30" stroke="#FFF6E9" stroke-width="2.5" stroke-dasharray="3 4"/>
      ${[0, 1, 2].map(r => [0, 1, 2].map(c => `<circle cx="${46 + c * 14}" cy="${62 + r * 14}" r="3" fill="#FFC53D"/>`).join('')).join('')}
      <path d="M34 98h52" stroke="#FFC53D" stroke-width="4"/>`, 'Cotton kurta', grad('kuB', '#2BC4B4', '#0F8F86')),
    C: () => svg(`<ellipse cx="60" cy="100" rx="38" ry="5" fill="#000" opacity=".12"/><rect x="26" y="58" width="68" height="40" rx="20" fill="url(#ebC)"/><rect x="26" y="58" width="68" height="14" rx="7" fill="#FFF6E9" opacity=".25"/>
      <circle cx="42" cy="38" r="12" fill="#FFF6E9"/><rect x="38" y="40" width="8" height="22" rx="4" fill="#FFF6E9"/><circle cx="78" cy="38" r="12" fill="#FFF6E9"/><rect x="74" y="40" width="8" height="22" rx="4" fill="#FFF6E9"/>
      <circle cx="42" cy="38" r="5" fill="#7B5CFF"/><circle cx="78" cy="38" r="5" fill="#7B5CFF"/>`, 'Wireless earbuds', grad('ebC', '#9B7BFF', '#6A45F0')),
    D: () => svg(`<ellipse cx="60" cy="100" rx="34" ry="5" fill="#000" opacity=".12"/><rect x="28" y="48" width="64" height="48" rx="8" fill="url(#gfD)"/><rect x="24" y="38" width="72" height="16" rx="6" fill="#FF4D2E"/><rect x="54" y="38" width="12" height="58" fill="#FFC53D"/>
      <path d="M60 38c-10-14-24-10-18-2 3 4 12 4 18 2zM60 38c10-14 24-10 18-2-3 4-12 4-18 2z" fill="#FFC53D"/>`, 'Gift case', grad('gfD', '#FF7A60', '#E5383B')),
    W: () => svg(`<ellipse cx="60" cy="108" rx="24" ry="4" fill="#000" opacity=".12"/><rect x="44" y="8" width="32" height="104" rx="12" fill="url(#wtW)"/><circle cx="60" cy="60" r="28" fill="#16131F"/><circle cx="60" cy="60" r="23" fill="url(#wtF)"/>
      <path d="M60 60V44M60 60l11 6" stroke="#FFF6E9" stroke-width="3.5" stroke-linecap="round"/><circle cx="60" cy="60" r="3" fill="#FFC53D"/><rect x="88" y="54" width="5" height="12" rx="2" fill="#16131F"/>`, 'Smart watch', grad('wtW', '#7AA2FF', '#4A72E8') + grad('wtF', '#2B2540', '#4A3C7A')),
    S: () => svg(`<ellipse cx="60" cy="104" rx="44" ry="5" fill="#000" opacity=".12"/><rect x="14" y="70" width="92" height="30" rx="8" fill="url(#bsS)"/><rect x="18" y="50" width="84" height="24" rx="8" fill="#7FE8BC"/><rect x="24" y="32" width="72" height="22" rx="10" fill="#FFF6E9"/>
      <path d="M24 84h72M20 62h80" stroke="#FFF6E9" stroke-width="3" stroke-dasharray="6 6"/>`, 'Cotton bedsheet', grad('bsS', '#3DDC97', '#1FAF73')),
    M: () => svg(`<ellipse cx="60" cy="100" rx="40" ry="5" fill="#000" opacity=".12"/><rect x="16" y="40" width="70" height="56" rx="10" fill="url(#mtM)"/><circle cx="86" cy="68" r="28" fill="url(#mtM)"/><circle cx="86" cy="68" r="18" fill="#FFF6E9" opacity=".35"/><circle cx="86" cy="68" r="8" fill="#FFF6E9" opacity=".5"/>`, 'Yoga mat', grad('mtM', '#B88CFF', '#7B5CFF')),
    K: () => svg(`<ellipse cx="60" cy="108" rx="22" ry="4" fill="#000" opacity=".12"/><rect x="48" y="10" width="24" height="14" rx="4" fill="#16131F"/><rect x="38" y="24" width="44" height="82" rx="16" fill="url(#btK)"/><rect x="46" y="40" width="8" height="52" rx="4" fill="#FFF6E9" opacity=".5"/>`, 'Steel water bottle', grad('btK', '#C9CFD8', '#7D8796')),
    R: () => svg(`<ellipse cx="60" cy="108" rx="20" ry="4" fill="#000" opacity=".12"/><rect x="52" y="8" width="16" height="22" rx="6" fill="#16131F"/><rect x="40" y="30" width="40" height="76" rx="12" fill="url(#srR)"/><rect x="46" y="52" width="28" height="30" rx="6" fill="#FFF6E9" opacity=".7"/>`, 'Face serum', grad('srR', '#FFB199', '#FF6F61')),
  };
  const PRODUCTS = {
    tracking: () => svg(`<rect x="10" y="18" width="100" height="84" rx="18" fill="url(#trA)"/><path d="M24 82c14-30 30 6 44-20s22-14 30-26" fill="none" stroke="#FFF6E9" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>
      <circle cx="24" cy="82" r="7" fill="#FF4D2E"/><path d="M90 20c-10 0-17 7-17 16 0 12 17 28 17 28s17-16 17-28c0-9-7-16-17-16z" fill="#FFF6E9"/><circle cx="90" cy="36" r="6" fill="#5B8CFF"/>`, 'Map with route and pin', grad('trA', '#6E9BFF', '#3E66E0')),
    start: () => svg(`<path d="M24 46l36-18 36 18v44l-36 18-36-18z" fill="url(#rtA)"/><path d="M24 46l36 18 36-18M60 64v44" fill="none" stroke="#FFF6E9" stroke-width="3" opacity=".7"/>
      <path d="M86 28a26 26 0 1 0-46-6" fill="none" stroke="#16131F" stroke-width="6" stroke-linecap="round"/><path d="M36 10l4 13 13-4" fill="none" stroke="#16131F" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`, 'Parcel with return arrow', grad('rtA', '#FF8A5C', '#FF4D2E')),
    exchange: () => svg(`<path d="M14 44l14-12h16c1 5 13 5 14 0h0l4 4v34H24V48z" fill="#FFC53D"/><path d="M58 64l14-12h16c1 5 13 5 14 0l4 4v40H68V68z" fill="url(#exA)"/>
      <path d="M78 26c12 2 20 10 20 20" fill="none" stroke="#16131F" stroke-width="5" stroke-linecap="round"/><path d="M92 40l6 8 7-8" fill="none" stroke="#16131F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M44 100c-12-2-20-10-20-20" fill="none" stroke="#16131F" stroke-width="5" stroke-linecap="round"/><path d="M30 86l-6-8-7 8" fill="none" stroke="#16131F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`, 'Two shirts being swapped', grad('exA', '#B88CFF', '#7B5CFF')),
    checkout: () => svg(`<rect x="18" y="20" width="60" height="84" rx="10" fill="#FFF6E9" stroke="#16131F" stroke-width="4"/><path d="M30 40h36M30 52h28M30 64h32" stroke="#16131F" stroke-width="4" stroke-linecap="round" opacity=".5"/>
      <rect x="46" y="62" width="64" height="42" rx="10" fill="url(#coA)"/><rect x="46" y="72" width="64" height="8" fill="#16131F" opacity=".7"/><rect x="56" y="88" width="20" height="6" rx="3" fill="#FFF6E9"/>
      <circle cx="40" cy="88" r="10" fill="#3DDC97"/><path d="M35 88l4 4 7-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`, 'Receipt and card', grad('coA', '#FFD566', '#FFB01F')),
    shipping: () => svg(`<path d="M18 92C40 30 80 100 102 28" fill="none" stroke="url(#shG)" stroke-width="4" stroke-linecap="round"/>
      <circle cx="18" cy="92" r="9" fill="#FF4D2E"/><circle cx="18" cy="92" r="15" fill="#FF4D2E" opacity=".25"/><circle cx="102" cy="28" r="9" fill="#3DDC97"/><circle cx="102" cy="28" r="15" fill="#3DDC97" opacity=".25"/>
      <circle cx="58" cy="62" r="10" fill="#7B5CFF"/><circle cx="58" cy="62" r="18" fill="#7B5CFF" opacity=".25"/>`, 'Route from red to green with a purple dot', grad('shG', '#FF4D2E', '#3DDC97')),
    report: () => svg(`<path d="M60 12l40 14v30c0 26-18 44-40 52-22-8-40-26-40-52V26z" fill="url(#rpA)"/><path d="M60 38v26" stroke="#FFF6E9" stroke-width="8" stroke-linecap="round"/><circle cx="60" cy="80" r="5" fill="#FFF6E9"/>`, 'Shield with alert', grad('rpA', '#FF6B6B', '#C9184A')),
  };
  g.ART = { item: id => (ITEMS[id] || ITEMS.D)(), product: k => (PRODUCTS[k] || PRODUCTS.start)() };
})(window);
