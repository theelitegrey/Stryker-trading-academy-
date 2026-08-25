// Stryker Trading Academy — shared loading animation
// Depends on: lottie-web (CDN, loaded before this file), assets/lottie/loading.json
//
// Two ways to use this:
//   1. Static HTML placeholders: give a container `data-lottie-auto` and an
//      inner `.loading-lottie-wrap` div — on page load, initLoadingAnimations()
//      finds every one of these and starts the animation automatically.
//      Markup: <div class="loading-state" data-lottie-auto>
//                <div class="loading-lottie-wrap"></div>
//                <p class="loading-state-text">Loading…</p>
//              </div>
//   2. JS-driven states (before/during a fetch): call
//      showLoadingAnimation(container, 'Loading whatever…') directly — it
//      injects the same markup and starts the animation in one call.

const LOADING_LOTTIE_PATH = 'assets/lottie/loading.json';

function loadingStateHtml(message){
  return (
    '<div class="loading-state">' +
      '<div class="loading-lottie-wrap"></div>' +
      (message ? '<p class="loading-state-text">' + message + '</p>' : '') +
    '</div>'
  );
}

function startLoadingLottie(wrapEl){
  if (!wrapEl || typeof lottie === 'undefined') return;
  lottie.loadAnimation({
    container: wrapEl,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: LOADING_LOTTIE_PATH
  });
}

// For JS that currently does `container.innerHTML = '<p>Loading X…</p>'` —
// replace that line with `showLoadingAnimation(container, 'Loading X…')`.
// Accepts either an element or an element ID.
function showLoadingAnimation(container, message){
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;
  el.innerHTML = loadingStateHtml(message);
  startLoadingLottie(el.querySelector('.loading-lottie-wrap'));
}

// For static HTML placeholders already in the markup — finds every
// data-lottie-auto container on the page and starts its animation.
function initLoadingAnimations(){
  document.querySelectorAll('[data-lottie-auto] .loading-lottie-wrap').forEach((wrapEl) => {
    startLoadingLottie(wrapEl);
  });
}

document.addEventListener('DOMContentLoaded', initLoadingAnimations);
