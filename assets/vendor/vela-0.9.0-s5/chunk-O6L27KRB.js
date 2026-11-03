// src/core/i18n/locale.ts
function canonicalLocale(tag) {
  const raw = typeof tag === "string" ? tag.trim() : "";
  if (!raw) return "en";
  try {
    return Intl.getCanonicalLocales(raw)[0] ?? raw;
  } catch {
    return raw;
  }
}
function parseLocale(tag) {
  try {
    return new Intl.Locale(tag);
  } catch {
    return null;
  }
}
function languageOf(tag) {
  return (parseLocale(tag)?.language ?? tag.split(/[-_]/)[0] ?? tag).toLowerCase();
}
function fallbackChain(tag) {
  const out = [];
  const add = (t) => {
    if (t && !out.includes(t)) out.push(t);
  };
  add(tag);
  const loc = parseLocale(tag);
  if (loc) {
    const base = loc.baseName;
    add(base);
    const parts = base.split("-");
    let impliedScript;
    if (!loc.script) {
      try {
        impliedScript = loc.maximize().script;
      } catch {
        impliedScript = void 0;
      }
    }
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      if (i === 1 && impliedScript && loc.region) add(`${loc.language}-${impliedScript}`);
      add(parts.slice(0, i).join("-"));
    }
    if (impliedScript && !loc.region) add(`${loc.language}-${impliedScript}`);
    try {
      const usual = new Intl.Locale(loc.language).maximize();
      if (usual.region && usual.script === (loc.script ?? impliedScript)) add(`${loc.language}-${usual.region}`);
    } catch {
    }
  }
  add("en");
  return out;
}
var RTL_SCRIPTS = /* @__PURE__ */ new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm", "Rohg", "Mand", "Samr", "Yezi"]);
var RTL_LANGUAGES = /* @__PURE__ */ new Set(["ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb", "ks"]);
function localeDirection(tag) {
  const loc = parseLocale(tag);
  if (loc) {
    try {
      const tl = loc;
      const info = typeof tl.getTextInfo === "function" ? tl.getTextInfo() : tl.textInfo;
      if (info?.direction === "rtl" || info?.direction === "ltr") return info.direction;
    } catch {
    }
    try {
      const script = loc.script ?? loc.maximize().script;
      if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
    } catch {
    }
  }
  return RTL_LANGUAGES.has(languageOf(tag)) ? "rtl" : "ltr";
}
var numberingCache = /* @__PURE__ */ new Map();
function resolveNumberingSystem(tag, requested) {
  const key = `${tag}|${requested ?? ""}`;
  const cached = numberingCache.get(key);
  if (cached) return cached;
  let nu = "latn";
  try {
    if (requested === "locale") nu = new Intl.NumberFormat(tag).resolvedOptions().numberingSystem;
    else if (requested) nu = new Intl.NumberFormat(tag, { numberingSystem: requested }).resolvedOptions().numberingSystem;
    else {
      const ext = parseLocale(tag)?.numberingSystem;
      if (ext) nu = new Intl.NumberFormat(tag).resolvedOptions().numberingSystem;
    }
  } catch {
    nu = "latn";
  }
  numberingCache.set(key, nu);
  return nu;
}

// src/core/i18n/registry.ts
var entries = [];
var version = 0;
var merged = /* @__PURE__ */ new Map();
function registerLocale(pack) {
  if (!pack || typeof pack.locale !== "string" || !pack.messages || typeof pack.messages !== "object") {
    throw new TypeError("[vela] registerLocale expects { locale: string, messages: Record<string, string> }");
  }
  const entry = { tag: canonicalLocale(pack.locale), messages: pack.messages };
  entries.push(entry);
  version += 1;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const i = entries.indexOf(entry);
    if (i >= 0) {
      entries.splice(i, 1);
      version += 1;
    }
  };
}
function registeredLocales() {
  return [...new Set(entries.map((e) => e.tag))];
}
function messagesFor(chain) {
  const key = chain.join("|");
  const hit = merged.get(key);
  if (hit && hit.version === version) return hit.map;
  const map = /* @__PURE__ */ new Map();
  for (let c = chain.length - 1; c >= 0; c -= 1) {
    const tag = chain[c];
    for (const e of entries) {
      if (e.tag !== tag) continue;
      for (const [id, text] of Object.entries(e.messages)) {
        if (typeof text === "string") map.set(id, text);
      }
    }
  }
  merged.set(key, { version, map });
  return map;
}

// src/core/format/numbers.ts
var BIDI_MARKS = /[‎‏؜]/g;
function stripBidiMarks(text) {
  return text.replace(BIDI_MARKS, "");
}
var numberFormats = /* @__PURE__ */ new Map();
function numberFormat(settings, options) {
  const key = `${settings.locale}|${settings.numberingSystem}|${JSON.stringify(options)}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    try {
      nf = new Intl.NumberFormat(settings.locale, { ...options, numberingSystem: settings.numberingSystem });
    } catch {
      nf = new Intl.NumberFormat("en", options);
    }
    numberFormats.set(key, nf);
  }
  return nf;
}
var symbolCache = /* @__PURE__ */ new Map();
function numberSymbols(settings) {
  const key = `${settings.locale}|${settings.numberingSystem}`;
  let sym = symbolCache.get(key);
  if (sym) return sym;
  const parts = numberFormat(settings, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 }).formatToParts(-1.5);
  const decimal = stripBidiMarks(parts.find((p) => p.type === "decimal")?.value ?? ".") || ".";
  const minus = stripBidiMarks(parts.find((p) => p.type === "minusSign")?.value ?? "-") || "-";
  const plain = numberFormat(settings, { useGrouping: false, maximumFractionDigits: 0 });
  const digits = Array.from({ length: 10 }, (_, d) => stripBidiMarks(plain.format(d)));
  const ascii = decimal === "." && minus === "-" && digits.every((d, i) => d === String(i));
  sym = { ascii, decimal, minus, digits };
  symbolCache.set(key, sym);
  return sym;
}
function localizeAscii(text, settings) {
  const sym = numberSymbols(settings);
  if (sym.ascii) return text;
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) out += sym.digits[code - 48];
    else if (ch === ".") out += sym.decimal;
    else if (ch === "-") out += sym.minus;
    else out += ch;
  }
  return out;
}
function localizeDigits(text, settings) {
  const sym = numberSymbols(settings);
  if (sym.digits.every((d, i) => d === String(i))) return text;
  return text.replace(/[0-9]/g, (d) => sym.digits[Number(d)]);
}
var clampDecimals = (d) => Number.isFinite(d) ? Math.max(0, Math.min(20, Math.trunc(d))) : 2;
function formatFixed(value, decimals, settings) {
  return localizeAscii(value.toFixed(clampDecimals(decimals)), settings);
}
function formatGrouped(value, decimals, settings) {
  const d = clampDecimals(decimals);
  return stripBidiMarks(numberFormat(settings, { minimumFractionDigits: d, maximumFractionDigits: d }).format(value));
}
function formatMessageNumber(value, settings, style) {
  if (style === "integer") return stripBidiMarks(numberFormat(settings, { maximumFractionDigits: 0 }).format(value));
  if (style === "percent") return stripBidiMarks(numberFormat(settings, { style: "percent" }).format(value));
  return stripBidiMarks(numberFormat(settings, {}).format(value));
}
function formatPercent(value, options, settings) {
  const d = clampDecimals(options?.decimals ?? 2);
  const signed = options?.signed ?? true;
  if (settings.english) {
    const text = signed ? `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(d)}%` : `${value.toFixed(d)}%`;
    return localizeAscii(text, settings);
  }
  const nf = numberFormat(settings, { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: signed ? "always" : "auto" });
  return stripBidiMarks(nf.format(value / 100));
}
function formatPrice(value, options, settings) {
  const mode = options.mode ?? "price";
  if (mode === "percent") return formatPercent(value, { decimals: options.decimals, signed: true }, settings);
  if (mode === "indexed" || !options.grouping) return formatFixed(value, options.decimals, settings);
  return formatGrouped(value, options.decimals, settings);
}
var COMPACT_STEPS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"]
];
function formatCompact(value, options, settings) {
  const d = clampDecimals(options?.decimals ?? 2);
  const trim = options?.trimZeros ?? true;
  if (settings.english) {
    const a = Math.abs(value);
    let div = 1;
    let suffix = "";
    for (const [step, s] of COMPACT_STEPS) {
      if (a >= step) {
        div = step;
        suffix = s;
        break;
      }
    }
    const scaled = value / div;
    const text = trim ? Number(scaled.toFixed(d)).toString() : scaled.toFixed(d);
    return localizeAscii(text, settings) + suffix;
  }
  const nf = numberFormat(settings, { notation: "compact", compactDisplay: "short", maximumFractionDigits: d, minimumFractionDigits: trim ? 0 : d });
  return stripBidiMarks(nf.format(value));
}

// src/core/format/dates.ts
var EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var EN_WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var pad2 = (n) => n < 10 ? `0${n}` : String(n);
var DAY_MS = 864e5;
var zoneParsers = /* @__PURE__ */ new Map();
// TradeZoro patch (s3 on 0.9.0): offset cached per zone and 15-minute bucket (computed at the
// bucket start; real zone offsets only change on those boundaries).
var stkTzOff = /* @__PURE__ */ new Map();
function zoneOffsetMs(ms, timeZone) {
  if (!timeZone || timeZone === "UTC") return 0;
  const q = Math.floor(ms / 9e5);
  const hk = timeZone + "|" + q;
  const hit = stkTzOff.get(hk);
  if (hit !== void 0) return hit;
  const v = stkZoneOffsetCalc(q * 9e5, timeZone);
  if (stkTzOff.size > 5e4) stkTzOff.clear();
  stkTzOff.set(hk, v);
  return v;
}
function stkZoneOffsetCalc(ms, timeZone) {
  let dtf = zoneParsers.get(timeZone);
  if (dtf === void 0) {
    try {
      dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      dtf = null;
    }
    zoneParsers.set(timeZone, dtf);
  }
  if (!dtf) return 0;
  try {
    const parts = dtf.formatToParts(new Date(ms));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUTC - ms;
  } catch {
    return 0;
  }
}
var dateFormats = /* @__PURE__ */ new Map();
function dateFormat(settings, options) {
  const key = `${settings.locale}|${settings.numberingSystem}|${JSON.stringify(options)}`;
  let dtf = dateFormats.get(key);
  if (!dtf) {
    const full = { ...options, timeZone: "UTC", calendar: "gregory", numberingSystem: settings.numberingSystem };
    try {
      dtf = new Intl.DateTimeFormat(settings.locale, full);
    } catch {
      dtf = new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC", calendar: "gregory" });
    }
    dateFormats.set(key, dtf);
  }
  return dtf;
}
function clockOptions(settings) {
  if (settings.hourCycle === "h23") return { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  if (settings.hourCycle === "h12") return { hour: "numeric", minute: "2-digit", hourCycle: "h12" };
  return { hour: "numeric", minute: "2-digit" };
}
function englishClock(wall, settings) {
  if (settings.hourCycle === "h23") return localizeAscii(`${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`, settings);
  return stripBidiMarks(dateFormat(settings, clockOptions(settings)).format(wall));
}
var TICK_OPTIONS = {
  year: { year: "numeric" },
  month: { month: "short" },
  day: { month: "short", day: "numeric" }
};
var isClockUnit = (unit) => unit === "hour" || unit === "minute" || unit === "second";
function formatTimeTick(ms, options, settings) {
  const wall = new Date(ms + (options.offsetMs ?? 0));
  const unit = options.unit;
  if (settings.english) {
    if (isClockUnit(unit)) return englishClock(wall, settings);
    const month = EN_MONTHS_SHORT[wall.getUTCMonth()];
    if (unit === "year") return localizeAscii(String(wall.getUTCFullYear()), settings);
    if (unit === "month") return month;
    return localizeAscii(`${month} ${wall.getUTCDate()}`, settings);
  }
  const opts = isClockUnit(unit) ? clockOptions(settings) : TICK_OPTIONS[unit];
  return stripBidiMarks(dateFormat(settings, opts).format(wall));
}
function formatTimeStamp(ms, options, settings) {
  const wall = new Date(ms + zoneOffsetMs(ms, options?.timeZone ?? "UTC"));
  const withTime = options?.withTime ?? true;
  if (settings.english) {
    const date = localizeAscii(
      `${EN_WEEKDAYS_SHORT[wall.getUTCDay()]} ${wall.getUTCDate()} ${EN_MONTHS_SHORT[wall.getUTCMonth()]} '${pad2(wall.getUTCFullYear() % 100)}`,
      settings
    );
    return withTime ? `${date} ${englishClock(wall, settings)}` : date;
  }
  const opts = { weekday: "short", day: "numeric", month: "short", year: "2-digit", ...withTime ? clockOptions(settings) : {} };
  return stripBidiMarks(dateFormat(settings, opts).format(wall));
}
function countdownText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1e3));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (v) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function spanParts(ms) {
  const m = Math.abs(ms);
  const HR = 36e5;
  const MIN = 6e4;
  if (m >= DAY_MS) {
    const d = Math.floor(m / DAY_MS);
    const h = Math.round(m % DAY_MS / HR);
    return h ? [[d, "day"], [h, "hour"]] : [[d, "day"]];
  }
  if (m >= HR) {
    const h = Math.floor(m / HR);
    const mn = Math.round(m % HR / MIN);
    return mn ? [[h, "hour"], [mn, "minute"]] : [[h, "hour"]];
  }
  if (m >= MIN) return [[Math.round(m / MIN), "minute"]];
  return [[Math.round(m / 1e3), "second"]];
}
var EN_UNIT = { day: "d", hour: "h", minute: "m", second: "s" };
function formatDuration(ms, options, settings) {
  if ((options?.style ?? "countdown") === "countdown") return localizeDigits(countdownText(ms), settings);
  const parts = spanParts(ms);
  if (settings.english) return localizeDigits(parts.map(([n, u]) => `${n}${EN_UNIT[u]}`).join(" "), settings);
  return parts.map(([n, unit]) => stripBidiMarks(numberFormat(settings, { style: "unit", unit, unitDisplay: "narrow" }).format(n))).join(" ");
}
var clockFormats = /* @__PURE__ */ new Map();
function formatClock(ms, options, settings) {
  const timeZone = options?.timeZone ?? "UTC";
  const seconds = options?.seconds ?? true;
  const english2 = settings.english && settings.hourCycle === "h23";
  const key = `${english2 ? "en-GB" : settings.locale}|${settings.numberingSystem}|${settings.hourCycle}|${timeZone}|${seconds}`;
  let dtf = clockFormats.get(key);
  if (dtf === void 0) {
    const base = { hour: "2-digit", minute: "2-digit", ...seconds ? { second: "2-digit" } : {}, timeZone };
    try {
      dtf = english2 ? new Intl.DateTimeFormat("en-GB", { ...base, hour12: false }) : new Intl.DateTimeFormat(settings.locale, {
        ...base,
        calendar: "gregory",
        numberingSystem: settings.numberingSystem,
        ...settings.hourCycle === "locale" ? {} : { hourCycle: settings.hourCycle }
      });
    } catch {
      dtf = null;
    }
    clockFormats.set(key, dtf);
  }
  if (!dtf) return "";
  try {
    return stripBidiMarks(dtf.format(new Date(ms)));
  } catch {
    return "";
  }
}

// src/core/format/calendar.ts
var EN_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var EN_MONTHS_SHORT_PICKER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var EN_WEEKDAYS_MIN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function monthNames(settings, width) {
  if (settings.english) return [...width === "long" ? EN_MONTHS_LONG : EN_MONTHS_SHORT_PICKER];
  const dtf = dateFormat(settings, { month: width });
  return Array.from({ length: 12 }, (_, m) => stripBidiMarks(dtf.format(Date.UTC(2e3, m, 15))));
}
function weekdayNames(settings) {
  if (settings.english) return [...EN_WEEKDAYS_MIN];
  const dtf = dateFormat(settings, { weekday: "short" });
  return Array.from({ length: 7 }, (_, d) => stripBidiMarks(dtf.format(Date.UTC(2e3, 0, 2 + d))));
}
function yearLabel(settings, year) {
  if (settings.english) return localizeAscii(String(year), settings);
  return stripBidiMarks(dateFormat(settings, { year: "numeric" }).format(Date.UTC(year, 6, 1)));
}
function plainInteger(settings, n) {
  return localizeAscii(String(Math.trunc(n)), settings);
}
var yearFirstCache = /* @__PURE__ */ new Map();
function yearBeforeMonth(settings) {
  if (settings.english) return false;
  const key = `${settings.locale}|${settings.numberingSystem}`;
  let first = yearFirstCache.get(key);
  if (first === void 0) {
    const types = dateFormat(settings, { year: "numeric", month: "long" }).formatToParts(Date.UTC(2026, 8, 15)).map((p) => p.type);
    first = types.indexOf("year") < types.indexOf("month");
    yearFirstCache.set(key, first);
  }
  return first;
}
var SUNDAY_REGIONS = /* @__PURE__ */ new Set([
  "AG",
  "AS",
  "BD",
  "BR",
  "BS",
  "BT",
  "BW",
  "BZ",
  "CA",
  "CN",
  "CO",
  "DM",
  "DO",
  "ET",
  "GT",
  "GU",
  "HK",
  "HN",
  "ID",
  "IL",
  "IN",
  "JM",
  "JP",
  "KE",
  "KH",
  "KR",
  "LA",
  "MH",
  "MM",
  "MO",
  "MT",
  "MX",
  "MZ",
  "NI",
  "NP",
  "PA",
  "PE",
  "PH",
  "PK",
  "PR",
  "PT",
  "PY",
  "SA",
  "SG",
  "SV",
  "TH",
  "TT",
  "TW",
  "UM",
  "US",
  "VE",
  "VI",
  "WS",
  "YE",
  "ZA",
  "ZW"
]);
var SATURDAY_REGIONS = /* @__PURE__ */ new Set(["AE", "AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA", "SD", "SY"]);
function localeWeekStart(locale) {
  let loc;
  try {
    loc = new Intl.Locale(locale);
  } catch {
    return 1;
  }
  try {
    const wl = loc;
    const info = typeof wl.getWeekInfo === "function" ? wl.getWeekInfo() : wl.weekInfo;
    const firstDay = info?.firstDay;
    if (typeof firstDay === "number") return firstDay === 7 ? 0 : firstDay === 6 ? 6 : 1;
  } catch {
  }
  let region = loc.region;
  if (!region) {
    try {
      region = loc.maximize().region;
    } catch {
      region = void 0;
    }
  }
  if (region && SUNDAY_REGIONS.has(region)) return 0;
  if (region && SATURDAY_REGIONS.has(region)) return 6;
  return 1;
}

// src/core/format/formatters.ts
function builtinFormatters(settings) {
  return {
    price: (value, options) => formatPrice(value, options, settings),
    percent: (value, options) => formatPercent(value, options, settings),
    compact: (value, options) => formatCompact(value, options, settings),
    timeTick: (ms, options) => formatTimeTick(ms, options, settings),
    timeStamp: (ms, options) => formatTimeStamp(ms, options, settings),
    duration: (ms, options) => formatDuration(ms, options, settings),
    clock: (ms, options) => formatClock(ms, options, settings)
  };
}
var ENGLISH_SETTINGS = Object.freeze({ locale: "en", numberingSystem: "latn", hourCycle: "h23", english: true });
var ENGLISH_FORMAT = builtinFormatters(ENGLISH_SETTINGS);
var warned = false;
function viaHost(host, value, ctx, fallback) {
  try {
    const out = host(value, ctx);
    if (typeof out === "string") return out;
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("[vela] a host formatter threw; the built-in formatting is used instead.", err);
    }
  }
  return fallback();
}
function resolveFormatters(settings, overrides) {
  const base = builtinFormatters(settings);
  if (!overrides) return base;
  const ctx = (surface, defaultSurface, timeZone, fallback) => ({
    locale: settings.locale,
    timeZone: timeZone ?? "UTC",
    surface: surface ?? defaultSurface,
    fallback
  });
  const o = overrides;
  return {
    price(value, options) {
      const fallback = () => base.price(value, options);
      if (typeof o.price !== "function") return fallback();
      return viaHost(o.price, value, { ...ctx(options.surface, "priceAxis", void 0, fallback), decimals: options.decimals, mintick: options.mintick, mode: options.mode ?? "price", paneId: options.paneId, grouping: options.grouping ?? false }, fallback);
    },
    percent(value, options) {
      const fallback = () => base.percent(value, options);
      if (typeof o.percent !== "function") return fallback();
      return viaHost(o.percent, value, { ...ctx(options?.surface, "statusLine", void 0, fallback), decimals: options?.decimals ?? 2, signed: options?.signed ?? true }, fallback);
    },
    compact(value, options) {
      const fallback = () => base.compact(value, options);
      if (typeof o.compact !== "function") return fallback();
      return viaHost(o.compact, value, { ...ctx(options?.surface, "priceAxis", void 0, fallback), decimals: options?.decimals ?? 2, trimZeros: options?.trimZeros ?? true }, fallback);
    },
    timeTick(ms, options) {
      const fallback = () => base.timeTick(ms, options);
      if (typeof o.timeTick !== "function") return fallback();
      return viaHost(o.timeTick, ms, { ...ctx(options.surface, "timeAxis", options.timeZone, fallback), unit: options.unit, major: options.major, offsetMs: options.offsetMs ?? 0 }, fallback);
    },
    timeStamp(ms, options) {
      const fallback = () => base.timeStamp(ms, options);
      if (typeof o.timeStamp !== "function") return fallback();
      return viaHost(o.timeStamp, ms, { ...ctx(options?.surface, "crosshair", options?.timeZone, fallback), withTime: options?.withTime ?? true }, fallback);
    },
    duration(ms, options) {
      const fallback = () => base.duration(ms, options);
      if (typeof o.duration !== "function") return fallback();
      return viaHost(o.duration, ms, { ...ctx(options?.surface, "lastPrice", void 0, fallback), style: options?.style ?? "countdown" }, fallback);
    },
    clock(ms, options) {
      const fallback = () => base.clock(ms, options);
      if (typeof o.clock !== "function") return fallback();
      return viaHost(o.clock, ms, { ...ctx(options?.surface, "clock", options?.timeZone, fallback), seconds: options?.seconds ?? true }, fallback);
    }
  };
}

// src/core/i18n/icu.ts
var Parser = class {
  constructor(src) {
    this.src = src;
    this.i = 0;
  }
  parse() {
    const nodes = this.message(false, 0);
    if (this.i < this.src.length) throw this.error("unmatched }");
    return nodes;
  }
  error(what) {
    return new SyntaxError(`[vela] message syntax: ${what} at ${this.i} in "${this.src}"`);
  }
  /** Text and arguments up to an unmatched `}` (left unread) or the end. */
  message(inPlural, depth) {
    if (depth > 8) throw this.error("nesting too deep");
    const src = this.src;
    const out = [];
    let text = "";
    const flush = () => {
      if (text) out.push(text);
      text = "";
    };
    while (this.i < src.length) {
      const ch = src[this.i];
      if (ch === "'") {
        const next = src[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
        } else if (next === "{" || next === "}" || inPlural && next === "#") {
          this.i += 1;
          while (this.i < src.length) {
            const c = src[this.i];
            if (c === "'") {
              if (src[this.i + 1] === "'") {
                text += "'";
                this.i += 2;
                continue;
              }
              this.i += 1;
              break;
            }
            text += c;
            this.i += 1;
          }
        } else {
          text += "'";
          this.i += 1;
        }
      } else if (ch === "{") {
        flush();
        this.i += 1;
        out.push(this.argument(depth));
      } else if (ch === "}") {
        break;
      } else if (ch === "#" && inPlural) {
        flush();
        out.push({ kind: "pound" });
        this.i += 1;
      } else {
        text += ch;
        this.i += 1;
      }
    }
    flush();
    return out;
  }
  skipSpace() {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i += 1;
  }
  word() {
    this.skipSpace();
    const start = this.i;
    while (this.i < this.src.length && !/[\s,{}]/.test(this.src[this.i])) this.i += 1;
    return this.src.slice(start, this.i);
  }
  expect(ch) {
    this.skipSpace();
    if (this.src[this.i] !== ch) throw this.error(`expected "${ch}"`);
    this.i += 1;
  }
  /** After a `{`: the argument through its closing `}`. */
  argument(depth) {
    const name = this.word();
    if (!name) throw this.error("empty argument name");
    this.skipSpace();
    if (this.src[this.i] === "}") {
      this.i += 1;
      return { kind: "arg", name };
    }
    this.expect(",");
    const type = this.word();
    this.skipSpace();
    if (type === "number") {
      let style;
      if (this.src[this.i] === ",") {
        this.i += 1;
        style = this.word() || void 0;
      }
      this.expect("}");
      return { kind: "arg", name, format: "number", style };
    }
    if (type === "plural" || type === "selectordinal" || type === "select") {
      this.expect(",");
      let offset = 0;
      this.skipSpace();
      if (type !== "select" && this.src.startsWith("offset:", this.i)) {
        this.i += "offset:".length;
        offset = Number(this.word());
        if (!Number.isFinite(offset)) throw this.error("bad offset");
      }
      const options = {};
      for (; ; ) {
        this.skipSpace();
        if (this.src[this.i] === "}") {
          this.i += 1;
          break;
        }
        const key = this.word();
        if (!key) throw this.error("expected a selector");
        this.expect("{");
        options[key] = this.message(type !== "select", depth + 1);
        this.expect("}");
      }
      if (!options.other) throw this.error(`"${name}" has no "other" option`);
      return type === "select" ? { kind: "select", name, options } : { kind: "plural", name, ordinal: type === "selectordinal", offset, options };
    }
    throw this.error(`unknown argument type "${type}"`);
  }
};
var parsed = /* @__PURE__ */ new Map();
var PARSE_CACHE_CAP = 2e3;
function parseMessage(source) {
  let nodes = parsed.get(source);
  if (!nodes) {
    nodes = new Parser(source).parse();
    if (parsed.size >= PARSE_CACHE_CAP) parsed.clear();
    parsed.set(source, nodes);
  }
  return nodes;
}
var pluralRules = /* @__PURE__ */ new Map();
function rulesFor(locale, ordinal) {
  const key = `${locale}|${ordinal ? "o" : "c"}`;
  let pr = pluralRules.get(key);
  if (!pr) {
    try {
      pr = new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" });
    } catch {
      pr = new Intl.PluralRules("en", { type: ordinal ? "ordinal" : "cardinal" });
    }
    pluralRules.set(key, pr);
  }
  return pr;
}
function render(nodes, values, rt, pound) {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") {
      out += node;
      continue;
    }
    if (node.kind === "pound") {
      out += pound == null ? "#" : rt.formatNumber(pound);
      continue;
    }
    const raw = values?.[node.name];
    if (node.kind === "arg") {
      if (raw === void 0) out += `{${node.name}}`;
      else if (typeof raw === "number") out += rt.formatNumber(raw, node.format === "number" ? node.style : void 0);
      else if (node.format === "number" && raw.trim() !== "" && Number.isFinite(Number(raw))) out += rt.formatNumber(Number(raw), node.style);
      else out += raw;
      continue;
    }
    if (node.kind === "select") {
      const branch2 = node.options[String(raw)] ?? node.options.other;
      out += render(branch2, values, rt, pound);
      continue;
    }
    const n = typeof raw === "number" ? raw : Number(raw);
    let branch;
    if (Number.isFinite(n)) {
      branch = node.options[`=${n}`] ?? node.options[rulesFor(rt.locale, node.ordinal).select(n - node.offset)];
    }
    out += render(branch ?? node.options.other, values, rt, Number.isFinite(n) ? n - node.offset : null);
  }
  return out;
}
function formatMessage(source, values, rt) {
  if (source.indexOf("{") < 0 && source.indexOf("'") < 0) return source;
  return render(parseMessage(source), values, rt, null);
}

// src/core/i18n/translator.ts
function isMessageDescriptor(m) {
  return typeof m === "object" && m !== null && typeof m.id === "string" && typeof m.defaultMessage === "string";
}
var LOCALIZATION_KEYS = ["locale", "direction", "messages", "numberingSystem", "hourCycle", "weekStart", "formatters"];
function pickLocalization(options) {
  const out = {};
  for (const key of LOCALIZATION_KEYS) if (key in options) out[key] = options[key];
  return out;
}
var warnedSyntax = false;
function resolveArgs(args, resolve) {
  if (!args) return void 0;
  let out = null;
  for (const key of Object.keys(args)) {
    const v = args[key];
    if (typeof v === "object" && v !== null) {
      out ?? (out = { ...args });
      out[key] = resolve(v);
    }
  }
  return out ?? args;
}
var LocaleState = class {
  constructor(options = {}) {
    this.runtime = {
      locale: "en",
      formatNumber: (value, style) => formatMessageNumber(value, this.settings, style)
    };
    this.opts = { ...options };
    this.resolve();
  }
  /** The options as last set (unresolved). */
  get options() {
    return this.opts;
  }
  /** Whether the host chose a locale; Vela stamps `lang` only then. */
  get localeExplicit() {
    return this.opts.locale !== void 0;
  }
  /** Whether the host chose a direction; Vela stamps `dir` only then. */
  get directionExplicit() {
    return this.opts.direction !== void 0;
  }
  /** Apply a change: fields present in `next` replace (an explicit `undefined` restores
   *  the default), absent fields keep their current value. */
  update(next) {
    const patch = typeof next === "string" ? { locale: next } : next;
    this.opts = { ...this.opts, ...patch };
    for (const key of Object.keys(this.opts)) {
      if (this.opts[key] === void 0) delete this.opts[key];
    }
    this.resolve();
  }
  resolve() {
    const o = this.opts;
    const locale = canonicalLocale(o.locale);
    const numberingSystem = resolveNumberingSystem(locale, o.numberingSystem);
    const hourCycle = o.hourCycle === "h12" || o.hourCycle === "locale" ? o.hourCycle : "h23";
    this.settings = { locale, numberingSystem, hourCycle, english: languageOf(locale) === "en" };
    this.chain = fallbackChain(locale);
    this.resolvedDirection = o.direction === "rtl" || o.direction === "ltr" ? o.direction : o.direction === "auto" ? localeDirection(locale) : "ltr";
    this.resolvedWeekStart = o.weekStart === 0 || o.weekStart === 1 || o.weekStart === 6 ? o.weekStart : localeWeekStart(locale);
    this.runtime.locale = locale;
    this.formatters = resolveFormatters(this.settings, o.formatters);
  }
  get locale() {
    return this.settings.locale;
  }
  get direction() {
    return this.resolvedDirection;
  }
  get numberingSystem() {
    return this.settings.numberingSystem;
  }
  get hourCycle() {
    return this.settings.hourCycle;
  }
  get weekStart() {
    return this.resolvedWeekStart;
  }
  get format() {
    return this.formatters;
  }
  /** The resolved settings the built-in formatters and calendar helpers read. */
  get formatSettings() {
    return this.settings;
  }
  t(message, args) {
    if (typeof message === "string") return message;
    if (!isMessageDescriptor(message)) return message == null ? "" : String(message);
    const { id, defaultMessage } = message;
    const bound = message.values;
    const values = resolveArgs(bound ? args ? { ...bound, ...args } : bound : args, (m) => this.t(m));
    const override = this.opts.messages?.[id];
    const source = typeof override === "string" ? override : messagesFor(this.chain).get(id) ?? defaultMessage;
    try {
      return formatMessage(source, values, this.runtime);
    } catch (err) {
      if (!warnedSyntax) {
        warnedSyntax = true;
        console.warn(`[vela] message "${id}" could not be formatted; the English text is used instead.`, err);
      }
      if (source === defaultMessage) return defaultMessage;
      try {
        return formatMessage(defaultMessage, values, this.runtime);
      } catch {
        return defaultMessage;
      }
    }
  }
};
function createTranslator(options) {
  return new LocaleState(options);
}
var english = null;
function englishTranslator() {
  english ?? (english = new LocaleState());
  return english;
}
function formatSettingsOf(i18n) {
  if (i18n instanceof LocaleState) return i18n.formatSettings;
  if (!i18n) return englishTranslator().formatSettings;
  return { locale: i18n.locale, numberingSystem: i18n.numberingSystem, hourCycle: i18n.hourCycle, english: languageOf(i18n.locale) === "en" };
}

// src/core/i18n/message.ts
function msg(id, defaultMessage) {
  return Object.freeze({ id, defaultMessage });
}
function withValues(message, values) {
  return Object.freeze({ id: message.id, defaultMessage: message.defaultMessage, values: { ...message.values, ...values } });
}

// src/core/palette.ts
var ACCENT = "#2962ff";
var ACCENT_BRIGHT = "#38c0fd";
var BULLISH = "#089981";
var BEARISH = "#f23645";
var NEUTRAL = "#787b86";
var HIGHLIGHT = "#e0b400";
var WARNING = "#ff9800";
var INFO = "#5b9cf6";
var MARKER = "#ff5d00";
var VALID = "#0ecb81";
var INVALID = "#f6465d";
var SESSION_PRE = "#f97316";
var SESSION_POST = "#0ea5e9";
var SESSION_OFF = "#9ca3af";
var SERIES_LINE = "#3b82f6";
var CROSSHAIR = "#9aa0ad";
var SLATE_DEEP = "#1e293b";
var SLATE = "#475569";
var CHIP_PLATE = "#595959";
var TRADE_LONG = ACCENT;
var TRADE_SHORT = BEARISH;
var TRADE_EXIT = "#d500f9";
var CATEGORICAL = [ACCENT, BULLISH, BEARISH, WARNING, "#7e57c2", "#26a69a", INFO, "#e573b5"];
function categoricalColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = h * 31 + key.charCodeAt(i) >>> 0;
  return CATEGORICAL[h % CATEGORICAL.length];
}

// src/core/icons.ts
var registry = /* @__PURE__ */ new Map();
function registerIcon(id, svg) {
  registry.set(id, svg);
}
function iconMarkup(id) {
  return registry.get(id) ?? null;
}
function icon(id) {
  return registry.get(id) ?? "";
}
function iconAt(id, px) {
  return icon(id).replace("<svg ", `<svg width="${px}" height="${px}" `);
}
function svg16(body, extra = "") {
  return `<svg viewBox="0 0 16 16" width="1em" height="1em" ${extra ? extra + " " : ""}fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function svg24(body, extra = "") {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" ${extra ? extra + " " : ""}fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function svg24Solid(body) {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none">${body}</svg>`;
}
var S = svg16;
registerIcon(
  "style-candles",
  S('<path d="M4.5 2v2M4.5 12v2M11.5 2v1.5M11.5 11v3"/><rect x="2.8" y="4" width="3.4" height="8" rx="0.6" fill="currentColor" fill-opacity="0.25"/><rect x="9.8" y="3.5" width="3.4" height="7.5" rx="0.6" fill="currentColor"/>')
);
registerIcon(
  "style-bars",
  S('<path d="M4.5 2.5v11M2.5 5h2M4.5 11h2"/><path d="M11.5 2.5v11M9.5 4.5h2M11.5 10.5h2"/>')
);
registerIcon("style-line", S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/>'));
registerIcon(
  "style-area",
  S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/><path d="M1.5 11.5 5.5 7l3 2.5 5-6V13.5h-12z" fill="currentColor" fill-opacity="0.25" stroke="none"/>')
);
registerIcon(
  "style-baseline",
  S('<path d="M1.5 8h13" stroke-dasharray="2 2"/><path d="M2.5 8 5.25 4.5 8 8h-5.5z" fill="currentColor" fill-opacity="0.25" stroke="none"/><path d="M2.5 8 5.25 4.5 8 8"/><path d="M8 8l2.75 3.5L13.5 8h-5.5z" fill="currentColor" fill-opacity="0.25" stroke="none"/><path d="M8 8l2.75 3.5L13.5 8"/>')
);
registerIcon(
  "style-heikinashi",
  S('<path d="M4.5 12v2M11.5 2v2"/><rect x="2.8" y="5" width="3.4" height="7" rx="0.6" fill="currentColor" fill-opacity="0.25"/><rect x="9.8" y="4" width="3.4" height="7" rx="0.6" fill="currentColor"/>')
);
registerIcon("indicators", S('<path d="M1.5 12.5 5 7l2.5 3.5L11 4l3.5 5"/><circle cx="11" cy="4" r="1.4" fill="currentColor" stroke="none"/>'));
registerIcon("undo", S('<path d="M6.2 9.5 2.7 6l3.5-3.5"/><path d="M2.7 6h6.8a3.65 3.65 0 0 1 0 7.3H7.5"/>'));
registerIcon("redo", S('<path d="M9.8 9.5 13.3 6 9.8 2.5"/><path d="M13.3 6H6.5a3.65 3.65 0 0 0 0 7.3h2"/>'));
registerIcon(
  "objects",
  S('<path d="M8 1.8 14 5 8 8.2 2 5z"/><path d="M2 8l6 3.2L14 8" opacity="0.7"/><path d="M2 11l6 3.2 6-3.2" opacity="0.4"/>')
);
registerIcon("clock", S('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.4 1.6"/>'));
registerIcon(
  "calendar",
  S('<rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.4"/><path d="M5.2 1.8v2.8M10.8 1.8v2.8M2.2 6.8h11.6"/>')
);
registerIcon("datawindow", S('<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.5"/><path d="M4.5 5.5h4M4.5 8h7M4.5 10.5h5.5"/>'));
registerIcon("camera", S('<path d="M5.5 4 6.5 2.5h3L10.5 4h3A1 1 0 0 1 14.5 5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><circle cx="8" cy="8.5" r="2.6"/>'));
registerIcon(
  "gear",
  S('<path d="M6.55 1.4h2.9l.32 1.72c.48.14.92.38 1.3.7l1.66-.55 1.45 2.5-1.35 1.1c.08.34.12.7.12 1.07s-.04.73-.12 1.07l1.35 1.1-1.45 2.5-1.66-.55a4.3 4.3 0 0 1-1.3.7L9.45 14.6h-2.9l-.32-1.72a4.3 4.3 0 0 1-1.3-.7l-1.66.55-1.45-2.5 1.35-1.1A4.4 4.4 0 0 1 3.05 7.94c0-.37.04-.73.12-1.07l-1.35-1.1 1.45-2.5 1.66.55c.38-.32.82-.56 1.3-.7L6.55 1.4z"/><circle cx="8" cy="8" r="2.2"/>')
);
registerIcon("search", S('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'));
registerIcon("bell", S('<path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11v1h11v-1L12 8.5V6a4 4 0 0 0-4-4z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/>'));
registerIcon(
  "market-open",
  svg24('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>')
);
registerIcon(
  "market-pre",
  svg24('<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>')
);
registerIcon(
  "market-post",
  svg24('<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 14-4 4-4-4"/><path d="M16 6a4 4 0 0 0-8 0"/>')
);
registerIcon(
  "market-extended",
  svg24('<path d="M22 22H2"/><path d="M12 3a5 5 0 0 0 7.5 7.5A7.5 7.5 0 1 1 12 3Z"/>')
);
registerIcon("market-closed", svg24('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'));
registerIcon(
  "market-holiday",
  svg24('<path d="m10 20-1.25-2.5L6 16"/><path d="M10 4 8.75 6.5 6 8"/><path d="m14 20 1.25-2.5L18 16"/><path d="m14 4 1.25 2.5L18 8"/><path d="m17 10-5 5-5-5"/><path d="M4 12h16"/>')
);
registerIcon("chevron-right", S('<path d="m6 3.5 4.5 4.5L6 12.5"/>'));
registerIcon("chevron-left", S('<path d="M10 3.5 5.5 8l4.5 4.5"/>'));
registerIcon("chevron-down", S('<path d="M3.5 6 8 10.5 12.5 6"/>'));
registerIcon("chevron-up", S('<path d="M3.5 10 8 5.5 12.5 10"/>'));
registerIcon("chevrons-right", S('<path d="m4 3.5 4.5 4.5L4 12.5"/><path d="m8.5 3.5 4.5 4.5-4.5 4.5"/>'));
registerIcon("chevrons-left", S('<path d="M12 3.5 7.5 8l4.5 4.5"/><path d="M7.5 3.5 3 8l4.5 4.5"/>'));
registerIcon("replay", S('<path d="M14 4.2v7.6L8.6 8z"/><path d="M7.4 4.2v7.6L2 8z"/>'));
registerIcon("check", S('<path d="m2.8 8.4 3.4 3.4 7-7.6"/>'));
registerIcon("close", S('<path d="m3.8 3.8 8.4 8.4M12.2 3.8l-8.4 8.4"/>'));
registerIcon("pin", S('<path d="M5.6 2.5h4.8M6.4 2.5v3.6L4.4 8.4v.9h7.2v-.9L9.6 6.1V2.5M8 9.3v4.2"/>'));
registerIcon("pin-filled", S('<path d="M5.6 2.5h4.8M6.4 2.5v3.6L4.4 8.4v.9h7.2v-.9L9.6 6.1V2.5M8 9.3v4.2"/><path d="M6.4 2.5h3.2v3.6l2 2.3v.9H4.4v-.9l2-2.3z" fill="currentColor" stroke="none"/>'));
registerIcon("eye", S('<path d="M1.5 8s2.5-5.4 6.5-5.4S14.5 8 14.5 8 12 13.4 8 13.4 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'));
registerIcon("eye-off", S('<path d="M1.5 8s2.5-5.4 6.5-5.4S14.5 8 14.5 8 12 13.4 8 13.4 1.5 8 1.5 8z" opacity="0.45"/><path d="m3 13 10-10"/>'));
registerIcon("lock", S('<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"/>'));
registerIcon("unlock", S('<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.7"/>'));
registerIcon("trash", S('<path d="M2.5 4.3h11M6.2 4.3V3.1a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.2M4.2 4.3l.5 9.1a1.15 1.15 0 0 0 1.15 1.1h4.3a1.15 1.15 0 0 0 1.15-1.1l.5-9.1M6.5 7v4.5M9.5 7v4.5"/>'));
registerIcon("group", S('<path d="M1.8 4.5V2.4a.6.6 0 0 1 .6-.6h2.1M11.5 1.8h2.1a.6.6 0 0 1 .6.6v2.1M14.2 11.5v2.1a.6.6 0 0 1-.6.6h-2.1M4.5 14.2H2.4a.6.6 0 0 1-.6-.6v-2.1"/><rect x="4" y="4" width="4.2" height="4.2" rx="0.7"/><rect x="7.8" y="7.8" width="4.2" height="4.2" rx="0.7"/>'));
registerIcon("ungroup", S('<rect x="1.6" y="1.6" width="6.2" height="6.2" rx="0.9"/><rect x="8.2" y="8.2" width="6.2" height="6.2" rx="0.9" stroke-dasharray="2 1.5"/>'));
registerIcon("clone", S('<rect x="5.5" y="5.5" width="9" height="9" rx="1.2"/><path d="M11 5.5v-3a1 1 0 0 0-1-1H2.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1h3"/>'));
registerIcon("arrow-up", S('<path d="M8 13.2V3M4.2 6.8 8 3l3.8 3.8"/>'));
registerIcon("arrow-down", S('<path d="M8 2.8V13M4.2 9.2 8 13l3.8-3.8"/>'));
registerIcon("move-vertical", S('<path d="M8 2.5v11M5 5.5 8 2.5l3 3M5 10.5l3 3 3-3"/>'));
registerIcon("move", S('<path d="M8 1.8v12.4M1.8 8h12.4M5.6 4.2 8 1.8l2.4 2.4M5.6 11.8 8 14.2l2.4-2.4M4.2 5.6 1.8 8l2.4 2.4M11.8 5.6 14.2 8l-2.4 2.4"/>'));
registerIcon("pen", S('<path d="m10.8 2.2 3 3-8 8-3.6.6.6-3.6z"/><path d="m9.2 3.8 3 3"/>'));
registerIcon("wave", S('<path d="M1.5 10.4c1.6 0 1.9-4.8 3.4-4.8s1.8 4.8 3.4 4.8 1.8-4.8 3.4-4.8 1.6 4.8 2.8 4.8"/>'));
registerIcon("folder-plus", S('<path d="M1.6 4.4a1 1 0 0 1 1-1h2.7l1.3 1.7h6.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1z"/><path d="M8 7.6v3.6M6.2 9.4h3.6"/>'));
registerIcon("folder-minus", S('<path d="M1.6 4.4a1 1 0 0 1 1-1h2.7l1.3 1.7h6.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1z"/><path d="M6.2 9.4h3.6"/>'));
registerIcon("collapse", S('<path d="M3 8h10"/>'));
registerIcon("expand", S('<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4"/><path d="M8 5.4v5.2M5.4 8h5.2"/>'));
registerIcon("plus", S('<path d="M8 2.8v10.4M2.8 8h10.4"/>'));
registerIcon("minus", S('<path d="M2.8 8h10.4"/>'));
registerIcon("maximize", S('<path d="M2.5 6V3a.5.5 0 0 1 .5-.5h3M10 2.5h3a.5.5 0 0 1 .5.5v3M13.5 10v3a.5.5 0 0 1-.5.5h-3M6 13.5H3a.5.5 0 0 1-.5-.5v-3"/>'));
registerIcon("restore", S('<path d="M6 2.5v3a.5.5 0 0 1-.5.5h-3M13.5 6h-3a.5.5 0 0 1-.5-.5v-3M10 13.5v-3a.5.5 0 0 1 .5-.5h3M2.5 10h3a.5.5 0 0 1 .5.5v3"/>'));
registerIcon("restore", S('<path d="M6.2 2.5v3.7H2.5M9.8 13.5V9.8h3.7M13.5 6.2H9.8V2.5M2.5 9.8h3.7v3.7"/>'));
registerIcon("star", S('<path d="M8 2.2l1.75 3.55 3.9.55-2.8 2.75.65 3.9L8 11.1l-3.5 1.85.65-3.9-2.8-2.75 3.9-.55z"/>'));
registerIcon("star-filled", S('<path d="M8 2.2l1.75 3.55 3.9.55-2.8 2.75.65 3.9L8 11.1l-3.5 1.85.65-3.9-2.8-2.75 3.9-.55z"/>', 'fill="currentColor"'));
registerIcon("grip", S('<circle cx="6" cy="3.5" r="1"/><circle cx="10" cy="3.5" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12.5" r="1"/><circle cx="10" cy="12.5" r="1"/>', 'fill="currentColor" stroke="none"'));
registerIcon("kebab", S('<circle cx="8" cy="3.2" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="12.8" r="1.2"/>', 'fill="currentColor" stroke="none"'));
registerIcon("burger", S('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>'));
registerIcon("info", S('<path d="M8 7.4v4.4"/><circle cx="8" cy="4.6" r="0.9" fill="currentColor" stroke="none"/>'));
registerIcon("reset", S('<path d="M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.5 1.83L2 5.33"/><path d="M2 2v3.33h3.33"/>'));
registerIcon("pane-collapse", S('<path d="M2.6 9.4h4v4M13.4 6.6h-4v-4"/><path d="m9.4 6.6 4.2-4.2M2.4 13.6l4.2-4.2"/>'));
registerIcon("pane-expand", S('<path d="M9.8 2.4h3.8v3.8M6.2 13.6H2.4V9.8"/><path d="m13.6 2.4-4.4 4.4M2.4 13.6l4.4-4.4"/>'));
registerIcon("cursor", svg24('<path d="M5 3l6 16 2-6 6-2z"/>', 'fill="currentColor" stroke="none"'));
registerIcon(
  "ruler",
  svg24('<path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>')
);
registerIcon(
  "magnet",
  svg24('<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>')
);
registerIcon(
  "eraser",
  svg24('<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13 5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L12 20"/><path d="M22 21H7"/><path d="m5 11 9 9"/>')
);
registerIcon(
  "pen-lock",
  svg24('<path d="M13.8 4.2a2.1 2.1 0 0 1 3 3L8.5 15.5l-3.5 1 1-3.5Z"/><rect x="13" y="14.5" width="8" height="6" rx="1.2"/><path d="M15 14.5v-1.6a2 2 0 0 1 4 0v1.6"/>')
);
registerIcon(
  "pen-sync",
  // Pen + two stacked panes — drawing onto every linked chart at once.
  svg24('<path d="M13.8 4.2a2.1 2.1 0 0 1 3 3L8.5 15.5l-3.5 1 1-3.5Z"/><rect x="12.5" y="13.5" width="6" height="4.8" rx="1"/><path d="M15.5 18.3v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.8a1 1 0 0 0-1-1h-1"/>')
);
registerIcon("brush", svg24('<path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/>'));
registerIcon(
  "bucket",
  svg24('<path d="m18.5 11.5-7-7L4 12a1.8 1.8 0 0 0 0 2.5l5 5a1.8 1.8 0 0 0 2.5 0Z"/><path d="m5 5 4 4"/><path d="M3.5 13.5h13"/><path d="M21 17.5c0 1.1-.9 2-2 2s-2-.9-2-2c0-1 1.2-1.7 2-3 .8 1.3 2 2 2 3Z"/>')
);
registerIcon("type", svg24('<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9.5 19.5h5"/>'));
registerIcon("bold", svg24('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/>', 'stroke-width="2.4"'));
registerIcon("italic", svg24('<path d="M15 5h-5M14 19H9M14.5 5 10 19"/>', 'stroke-width="2.2"'));
registerIcon("price-delta", svg24('<path d="M12 4v16"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/>'));
registerIcon("date-delta", svg24('<path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>'));
registerIcon("bring-front", svg24('<rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/><path d="M4.5 10.5V6a1.5 1.5 0 0 1 1.5-1.5h4.5"/><path d="M19.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-4.5"/>'));
registerIcon(
  "send-back",
  svg24('<rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.35"/><path d="M4.5 10.5V6a1.5 1.5 0 0 1 1.5-1.5h4.5"/><path d="M19.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-4.5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>')
);
registerIcon("r-squared", '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none"><text x="2.5" y="17.5" font-size="14" font-family="serif">R²</text></svg>');
registerIcon("bands", svg24('<path d="M3 6h18"/><path d="M3 18h18"/><path d="M3 12h18" stroke-dasharray="3 3"/>'));
registerIcon("dedekind", svg24('<path d="M2 20h20"/><path d="M4 20a8 8 0 0 1 16 0"/><path d="M8 20a4 4 0 0 1 8 0"/><path d="M12 4v16"/>'));
registerIcon("sonic", svg24('<circle cx="15" cy="12" r="4"/><circle cx="12" cy="12" r="2.5"/><path d="M8 5v14"/>'));
registerIcon("supersonic", svg24('<circle cx="16" cy="12" r="3.5"/><path d="M6 12 15 6M6 12 15 18"/>'));

// src/core/color.ts
function parseRgb(color) {
  const s = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16)
    };
  }
  m = /^#([0-9a-f]{6})[0-9a-f]{0,2}$/i.exec(s);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
  if (rgb) {
    return { r: parseFloat(rgb[1]), g: parseFloat(rgb[2]), b: parseFloat(rgb[3]) };
  }
  return null;
}
function withAlpha(color, alpha) {
  const c = parseRgb(color);
  if (!c) return color;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}
function mix(base, top, alpha) {
  const b = parseRgb(base);
  const t = parseRgb(top);
  if (!b || !t) return base;
  const c = (x, y) => Math.round(x + (y - x) * alpha);
  return `rgb(${c(b.r, t.r)},${c(b.g, t.g)},${c(b.b, t.b)})`;
}
function toHex6(color, fallback = "#888888") {
  const c = parseRgb(color);
  if (!c) return fallback;
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function isDarkColor(color) {
  const c = parseRgb(color);
  if (!c) return true;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
}

// src/ui/styles.ts
function overlayScrollbarCss(selector, width = 8) {
  return `${selector}::-webkit-scrollbar{width:${width}px;height:${width}px;}${selector}::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}${selector}::-webkit-scrollbar-track{background:transparent;}${selector}::-webkit-scrollbar-button{display:none;width:0;height:0;}`;
}
var FIELD_FOCUS_CSS = "outline:none;transition:border-color .12s ease,box-shadow .12s ease;";
var FIELD_FOCUS_RING = "border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);";
function injectStyles(id, css, root = document) {
  if (typeof document === "undefined") return;
  const host = root instanceof Document ? root.head : root;
  if (root.getElementById?.(id) ?? host.querySelector(`#${CSS.escape(id)}`)) return;
  const s = document.createElement("style");
  s.id = id;
  s.textContent = css;
  host.appendChild(s);
}

// src/ui/icons.ts
function iconEl(id, doc = document) {
  const span = doc.createElement("span");
  span.className = "vela-icon";
  span.setAttribute("aria-hidden", "true");
  const svg = iconMarkup(id);
  if (svg) span.innerHTML = svg;
  return span;
}

// src/ui/surface-events.ts
var SURFACE_OPEN_EVENT = "vela:surface-open";
var SURFACE_CLOSE_EVENT = "vela:surface-close";
function announceSurface(el, open, kind, trigger = null) {
  const View = el.ownerDocument.defaultView;
  if (!View) return;
  el.dispatchEvent(
    new View.CustomEvent(open ? SURFACE_OPEN_EVENT : SURFACE_CLOSE_EVENT, { bubbles: true, composed: true, detail: { kind, trigger } })
  );
}

// src/core/i18n/text.ts
var ENGLISH_RUNTIME = {
  locale: "en",
  formatNumber: (value, style) => formatMessageNumber(value, ENGLISH_SETTINGS, style)
};
function sourceText(message, values) {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (!isMessageDescriptor(message)) return String(message);
  const bound = message.values;
  const all = resolveArgs(bound ? values ? { ...bound, ...values } : bound : values, (m) => sourceText(m));
  try {
    return formatMessage(message.defaultMessage, all, ENGLISH_RUNTIME);
  } catch {
    return message.defaultMessage;
  }
}
function textOf(i18n, message, values) {
  return (i18n ?? englishTranslator()).t(message, values);
}
function upperCase(text, locale) {
  try {
    return text.toLocaleUpperCase(locale);
  } catch {
    return text.toUpperCase();
  }
}
function localizeNumberText(text, i18n) {
  return localizeAscii(text, formatSettingsOf(i18n));
}
function eventTimeText(ms, i18n) {
  if (!i18n || i18n instanceof LocaleState && !i18n.localeExplicit) return new Date(ms).toLocaleTimeString();
  let timeZone;
  try {
    timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = void 0;
  }
  return i18n.format.clock(ms, { surface: "clock", ...timeZone ? { timeZone } : {} });
}
function sliceGraphemes(text, count) {
  if (count <= 0) return "";
  if (/^[ -~]*$/.test(text)) return text.slice(0, count);
  const graphemes = textSegmenter(void 0, "grapheme");
  if (graphemes) {
    let out = "";
    let n = 0;
    for (const { segment } of graphemes.segment(text)) {
      if (n++ >= count) break;
      out += segment;
    }
    return out;
  }
  return Array.from(text).slice(0, count).join("");
}
var segmenters = /* @__PURE__ */ new Map();
function textSegmenter(locale, granularity) {
  const key = `${locale ?? ""}|${granularity}`;
  let s = segmenters.get(key);
  if (s === void 0) {
    const Ctor = Intl.Segmenter;
    try {
      s = Ctor ? new Ctor(locale, { granularity }) : null;
    } catch {
      s = null;
    }
    segmenters.set(key, s);
  }
  return s;
}

// src/ui/surface-exit.ts
var CLOSING_ATTR = "data-closing";
var SURFACE_EXIT_CAP_MS = 1e3;
function animationsOf(els) {
  return els.flatMap((el) => el.getAnimations({ subtree: true }));
}
function ends(a) {
  return Number.isFinite(a.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY);
}
function holdForExit(els, done, opts = {}) {
  const list = Array.isArray(els) ? els : [els];
  if (list.length === 0 || !list.every((el) => typeof el.getAnimations === "function")) {
    done();
    return null;
  }
  const before = new Set(animationsOf(list));
  for (const el of list) el.setAttribute(CLOSING_ATTR, "");
  const exit = animationsOf(list).filter((a) => !before.has(a) && ends(a));
  if (exit.length === 0) {
    for (const el of list) el.removeAttribute(CLOSING_ATTR);
    done();
    return null;
  }
  const frozen = [...list, ...opts.inert ?? []];
  const wasInert = frozen.map((el) => el.inert);
  for (const el of frozen) el.inert = true;
  let settled = false;
  const settle = (complete) => {
    if (settled) return;
    settled = true;
    clearTimeout(cap);
    for (const el of list) el.removeAttribute(CLOSING_ATTR);
    frozen.forEach((el, i) => {
      el.inert = wasInert[i];
    });
    if (complete) done();
  };
  const cap = setTimeout(() => settle(true), SURFACE_EXIT_CAP_MS);
  let pending = exit.length;
  const one = () => {
    if (--pending === 0) settle(true);
  };
  for (const a of exit) a.finished.then(one, one);
  return {
    cancel: () => settle(false),
    finish: () => settle(true)
  };
}

export { ACCENT, ACCENT_BRIGHT, BEARISH, BULLISH, CATEGORICAL, CHIP_PLATE, CROSSHAIR, ENGLISH_FORMAT, FIELD_FOCUS_CSS, FIELD_FOCUS_RING, HIGHLIGHT, INFO, INVALID, LocaleState, MARKER, NEUTRAL, SERIES_LINE, SESSION_OFF, SESSION_POST, SESSION_PRE, SLATE, SLATE_DEEP, SURFACE_CLOSE_EVENT, SURFACE_OPEN_EVENT, TRADE_EXIT, TRADE_LONG, TRADE_SHORT, VALID, WARNING, announceSurface, categoricalColor, createTranslator, englishTranslator, eventTimeText, formatSettingsOf, holdForExit, icon, iconAt, iconEl, iconMarkup, injectStyles, isDarkColor, localizeNumberText, mix, monthNames, msg, overlayScrollbarCss, pickLocalization, plainInteger, registerIcon, registerLocale, registeredLocales, sliceGraphemes, sourceText, svg16, svg24, svg24Solid, textOf, textSegmenter, toHex6, upperCase, weekdayNames, withAlpha, withValues, yearBeforeMonth, yearLabel, zoneOffsetMs };
