// Stryker Trading Academy — shared loading animation
//
// The loader is a brand-built candlestick pulse: five candles breathing in
// sequence under a scanning price line — pure CSS/SVG, no library, themed to
// the site's bull/bear palette. (Replaces the old generic lottie spinner;
// the lottie CDN tag on older pages is simply unused now.)
//
// Two ways to use it, same API as before:
//   1. Static HTML placeholders: a container with `data-lottie-auto` and an
//      inner `.loading-lottie-wrap` div gets the loader injected on load.
//   2. JS-driven: showLoadingAnimation(containerOrId, 'Loading whatever…').

function stkLoaderHtml(){
  // heights/delays tuned so the wave reads left-to-right like a forming tape
  const candles = [
    { h: 26, d: 0.00, bull: true  },
    { h: 42, d: 0.12, bull: false },
    { h: 54, d: 0.24, bull: true  },
    { h: 34, d: 0.36, bull: true  },
    { h: 46, d: 0.48, bull: false }
  ];
  return (
    '<div class="stk-loader-candles" aria-hidden="true">' +
      candles.map(c =>
        '<span class="stk-candle ' + (c.bull ? 'bull' : 'bear') + '"' +
        ' style="height:' + c.h + 'px; animation-delay:' + c.d + 's"></span>'
      ).join('') +
      '<span class="stk-scan"></span>' +
    '</div>'
  );
}

function loadingStateHtml(message){
  return (
    '<div class="loading-state">' +
      '<div class="loading-lottie-wrap">' + stkLoaderHtml() + '</div>' +
      (message ? '<p class="loading-state-text">' + message + '</p>' : '') +
    '</div>'
  );
}

// For JS that currently does `container.innerHTML = '<p>Loading X…</p>'` —
// replace that line with `showLoadingAnimation(container, 'Loading X…')`.
// Accepts either an element or an element ID.
function showLoadingAnimation(container, message){
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;
  el.innerHTML = loadingStateHtml(message);
}

// For static HTML placeholders already in the markup — finds every
// data-lottie-auto container on the page and injects the loader.
function initLoadingAnimations(){
  document.querySelectorAll('[data-lottie-auto] .loading-lottie-wrap').forEach((wrapEl) => {
    if (!wrapEl.querySelector('.stk-loader-candles')) wrapEl.innerHTML = stkLoaderHtml();
  });
}

document.addEventListener('DOMContentLoaded', initLoadingAnimations);
