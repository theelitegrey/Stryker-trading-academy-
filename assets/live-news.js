// Stryker Trading Academy — symbol-focused live news feed (market-news.html)
//
// TradingView's Timeline widget only supports two modes: "all_symbols" (a
// firehose across every stock/instrument they cover, which buries
// forex/gold-relevant stories under a much larger volume of unrelated
// stock news) or "symbol" (a feed for one specific instrument). This tabs
// between "symbol" feeds for the instruments this curriculum actually
// covers, which surfaces more relevant — and usually timelier — headlines
// than the generic firehose did.

const NEWS_SYMBOLS = [
  { label: 'Gold', symbol: 'TVC:GOLD' },
  { label: 'EUR/USD', symbol: 'FX_IDC:EURUSD' },
  { label: 'GBP/USD', symbol: 'FX_IDC:GBPUSD' },
  { label: 'Nasdaq', symbol: 'FOREXCOM:NSXUSD' },
  { label: 'Dow 30', symbol: 'FOREXCOM:DJI' },
  { label: 'Bitcoin', symbol: 'BITSTAMP:BTCUSD' },
  { label: 'All markets', symbol: null }
];

let selectedNewsSymbol = NEWS_SYMBOLS[0];

function renderNewsWidget(){
  const target = document.getElementById('news-widget');
  if (!target) return;
  target.innerHTML = '<div class="tradingview-widget-container__widget"></div>';

  const config = {
    isTransparent: true,
    displayMode: 'regular',
    width: '100%',
    height: 550,
    colorTheme: 'dark',
    locale: 'en'
  };
  if (selectedNewsSymbol.symbol) {
    config.feedMode = 'symbol';
    config.symbol = selectedNewsSymbol.symbol;
  } else {
    config.feedMode = 'all_symbols';
  }

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js';
  script.async = true;
  script.text = JSON.stringify(config);
  target.appendChild(script);
}

function renderNewsTabs(){
  const wrap = document.getElementById('news-symbol-filter');
  if (!wrap) return;
  wrap.innerHTML = '';
  NEWS_SYMBOLS.forEach((entry) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-tab' + (entry.label === selectedNewsSymbol.label ? ' active' : '');
    btn.textContent = entry.label;
    btn.addEventListener('click', () => {
      selectedNewsSymbol = entry;
      renderNewsTabs();
      renderNewsWidget();
    });
    wrap.appendChild(btn);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('news-widget')) return;
  renderNewsTabs();
  renderNewsWidget();
});
