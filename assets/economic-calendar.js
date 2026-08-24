// Stryker Trading Academy — Economic Calendar currency filter (market-news.html)
//
// Honest limitation: TradingView's embeddable Economic Calendar widget only
// exposes "importance" and "currency/country" as configurable filters in its
// public embed API — there's no date-range (week/month) parameter, that's
// only available as click-based navigation on TradingView's own full
// calendar page, not through this lightweight embed. So this filters by
// currency for real; it does not (and can't) offer a working date-range
// toggle without switching to a completely different data source.

const CURRENCY_TO_COUNTRY = {
  USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp',
  AUD: 'au', CAD: 'ca', CHF: 'ch', NZD: 'nz', CNY: 'cn'
};

let selectedCurrencies = new Set(Object.keys(CURRENCY_TO_COUNTRY));

function renderCalendarWidget(){
  const target = document.getElementById('econ-calendar-widget');
  if (!target) return;
  target.innerHTML = '<div class="tradingview-widget-container__widget"></div>';

  const countryFilter = Array.from(selectedCurrencies).map(c => CURRENCY_TO_COUNTRY[c]).join(',');

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';
  script.async = true;
  script.text = JSON.stringify({
    colorTheme: 'dark',
    isTransparent: true,
    width: '100%',
    height: 500,
    locale: 'en',
    importanceFilter: '-1,0,1',
    countryFilter: countryFilter || 'us'
  });
  target.appendChild(script);
}

function renderCurrencyChips(){
  const wrap = document.getElementById('econ-currency-filter');
  if (!wrap) return;
  wrap.innerHTML = '';
  Object.keys(CURRENCY_TO_COUNTRY).forEach((code) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-tab' + (selectedCurrencies.has(code) ? ' active' : '');
    btn.textContent = code;
    btn.addEventListener('click', () => {
      if (selectedCurrencies.has(code)) {
        if (selectedCurrencies.size === 1) return; // keep at least one currency selected
        selectedCurrencies.delete(code);
      } else {
        selectedCurrencies.add(code);
      }
      renderCurrencyChips();
      renderCalendarWidget();
    });
    wrap.appendChild(btn);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('econ-calendar-widget')) return;
  renderCurrencyChips();
  renderCalendarWidget();
});
