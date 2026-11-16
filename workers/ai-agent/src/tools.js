// TradeZoro AI agent: the MCP tool catalogue (phase 1). One small visible action per tool.
// scope: the OAuth scope a grant needs to call it. kind: the rate-limit bucket (read 60/min, chart 30/min, del 5/min per grant).
// tab: true = the call is relayed to the member's open ZoroCharts tab (assets/chart-ai-agent.js runs it there and answers).
// NO TRADING TOOLS (standing rule: no real broker orders for members). A later admin-only scope (mcp:trade) would add tools here
// behind the same Finatic guards as functions/connect/finatic/order.js; the table, scope check and relay need no change for that.

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const tab = { type: 'string', description: 'Optional tab id from chart_list. Default: the chart tab the member used last.' };
const cell = { type: 'integer', minimum: 1, maximum: 16, description: 'Optional chart number in a multi-chart layout (1 = first). Default: the active chart.' };
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DEL = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  { name: 'chart_list', scope: 'mcp:read', kind: 'read', tab: false, annotations: RO,
    description: 'List the member\'s open ZoroCharts tabs (device, visible or not, layout). Use the id as "tab" in other tools.',
    inputSchema: S({}) },
  { name: 'chart_status', scope: 'mcp:read', kind: 'read', tab: true, annotations: RO,
    description: 'Short status of the open chart: symbol, timeframe, layout, each chart in the layout, and whether the data is live or delayed.',
    inputSchema: S({ tab }) },
  { name: 'chart_read', scope: 'mcp:read', kind: 'read', tab: true, annotations: RO,
    description: 'Read one chart: symbol, timeframe, indicators with their inputs and latest plotted values, the last N candles (OHLCV, time in UTC seconds) and the drawings. Only what the member can see on screen.',
    inputSchema: S({ tab, chart: cell, bars: { type: 'integer', minimum: 1, maximum: 500, description: 'How many recent candles (default 50).' } }) },
  { name: 'symbol_resolve', scope: 'mcp:read', kind: 'read', tab: true, annotations: RO,
    description: 'Search ZoroCharts symbols by name or ticker (e.g. "NQ", "nasdaq futures", "BTCUSDT"). Returns the exact symbol ids to pass to chart_symbol.',
    inputSchema: S({ tab, query: { type: 'string', minLength: 1, maxLength: 40 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['query']) },
  { name: 'chart_screenshot', scope: 'mcp:read', kind: 'read', tab: true, annotations: RO,
    description: 'PNG image of the chart pane as the member sees it.',
    inputSchema: S({ tab, chart: cell }) },
  { name: 'chart_symbol', scope: 'mcp:chart', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Switch the chart to another symbol (e.g. "NQ", "ES", "BTCUSDT", or an id from symbol_resolve).',
    inputSchema: S({ tab, chart: cell, symbol: { type: 'string', minLength: 1, maxLength: 40 } }, ['symbol']) },
  { name: 'chart_timeframe', scope: 'mcp:chart', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Change the timeframe: 1, 5, 15, 30, 60, 240 (minutes), 1D, 1W, 1M; also "1m", "5m", "1h", "4h", "1d".',
    inputSchema: S({ tab, chart: cell, timeframe: { type: 'string', minLength: 1, maxLength: 8 } }, ['timeframe']) },
  { name: 'layout_set', scope: 'mcp:chart', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Show 1, 2 or 4 charts in the layout.',
    inputSchema: S({ tab, charts: { type: 'integer', enum: [1, 2, 4] } }, ['charts']) },
  { name: 'indicator_add', scope: 'mcp:chart', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Add an indicator by name (e.g. "EMA", "SMA", "RSI", "VWAP", "Bollinger Bands", or a TradeZoro indicator title) with optional inputs such as {"length": 20}.',
    inputSchema: S({ tab, chart: cell, name: { type: 'string', minLength: 1, maxLength: 60 }, inputs: { type: 'object', description: 'Input values by key, e.g. {"length": 20}.' } }, ['name']) },
  { name: 'indicator_update', scope: 'mcp:chart', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Change the inputs of an indicator already on the chart (id from chart_read).',
    inputSchema: S({ tab, chart: cell, id: { type: 'string', minLength: 1, maxLength: 80 }, inputs: { type: 'object' } }, ['id', 'inputs']) },
  { name: 'indicator_remove', scope: 'mcp:chart', kind: 'del', tab: true, annotations: DEL,
    description: 'Remove one indicator from the chart (id from chart_read).',
    inputSchema: S({ tab, chart: cell, id: { type: 'string', minLength: 1, maxLength: 80 } }, ['id']) },
  { name: 'drawing_add', scope: 'mcp:chart', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Draw on the price pane. type: hline (price), trendline (two points), fib (two points: from, to), rectangle (two corners), text (one point + text). Points are {time: UTC seconds, price}.',
    inputSchema: S({ tab, chart: cell, type: { type: 'string', enum: ['hline', 'trendline', 'fib', 'rectangle', 'text'] },
      points: { type: 'array', minItems: 1, maxItems: 2, items: S({ time: { type: 'number' }, price: { type: 'number' } }, ['price']) },
      text: { type: 'string', maxLength: 80 } }, ['type', 'points']) },
  { name: 'drawing_remove', scope: 'mcp:chart', kind: 'del', tab: true, annotations: DEL,
    description: 'Remove one drawing (id from chart_read).',
    inputSchema: S({ tab, chart: cell, id: { type: 'string', minLength: 1, maxLength: 80 } }, ['id']) },
  { name: 'alert_list', scope: 'mcp:alerts', kind: 'read', tab: true, annotations: RO,
    description: 'List the member\'s price alerts.',
    inputSchema: S({ tab }) },
  { name: 'alert_create', scope: 'mcp:alerts', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Create a price alert. condition: crossing, crossing_up, crossing_down, greater_than, less_than. frequency: once or every.',
    inputSchema: S({ tab, symbol: { type: 'string', minLength: 1, maxLength: 40 }, price: { type: 'number' },
      condition: { type: 'string', enum: ['crossing', 'crossing_up', 'crossing_down', 'greater_than', 'less_than'] },
      frequency: { type: 'string', enum: ['once', 'every'] }, message: { type: 'string', maxLength: 80 } }, ['symbol', 'price']) },
  { name: 'alert_delete', scope: 'mcp:alerts', kind: 'del', tab: true, annotations: DEL,
    description: 'Delete one price alert (id from alert_list).',
    inputSchema: S({ tab, id: { type: 'string', minLength: 1, maxLength: 80 } }, ['id']) },
  { name: 'watchlist_get', scope: 'mcp:alerts', kind: 'read', tab: true, annotations: RO,
    description: 'The symbols in the member\'s current watchlist.',
    inputSchema: S({ tab }) },
  { name: 'watchlist_add', scope: 'mcp:alerts', kind: 'chart', tab: true, annotations: EDIT,
    description: 'Add a symbol to the current watchlist.',
    inputSchema: S({ tab, symbol: { type: 'string', minLength: 1, maxLength: 40 } }, ['symbol']) },
  { name: 'watchlist_remove', scope: 'mcp:alerts', kind: 'del', tab: true, annotations: DEL,
    description: 'Remove a symbol from the current watchlist.',
    inputSchema: S({ tab, symbol: { type: 'string', minLength: 1, maxLength: 40 } }, ['symbol']) }
];
export const TOOL = new Map(TOOLS.map((t) => [t.name, t]));

// tools/list payload: a grant only sees the tools its scope allows (a read-only connection is not even offered chart_symbol).
export function listFor(scope) {
  const have = new Set(scope);
  return TOOLS.filter((t) => have.has(t.scope)).map((t) => ({ name: t.name, title: t.name.replace(/_/g, ' '), description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }));
}

// Minimal JSON-schema check for our own flat schemas (type, enum, min/max, required, no extra keys). Returns an error string or ''.
export function checkArgs(schema, args) {
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  if (JSON.stringify(args).length > 8192) return 'arguments too large';
  for (const k of schema.required || []) if (args[k] == null) return 'missing "' + k + '"';
  for (const [k, v] of Object.entries(args)) {
    const p = schema.properties[k];
    if (!p) return 'unknown argument "' + k + '"';
    const e = checkVal(p, v, k); if (e) return e;
  }
  return '';
}
function checkVal(p, v, k) {
  const t = p.type;
  if (t === 'string') { if (typeof v !== 'string') return '"' + k + '" must be a string'; if (p.minLength && v.length < p.minLength) return '"' + k + '" is empty'; if (p.maxLength && v.length > p.maxLength) return '"' + k + '" is too long'; }
  else if (t === 'integer') { if (!Number.isInteger(v)) return '"' + k + '" must be a whole number'; }
  else if (t === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) return '"' + k + '" must be a number'; }
  else if (t === 'object') { if (!v || typeof v !== 'object' || Array.isArray(v)) return '"' + k + '" must be an object'; if (p.properties) { const e = checkArgs(p, v); if (e) return e; } else if (Object.keys(v).length > 30) return '"' + k + '" has too many keys'; }
  else if (t === 'array') { if (!Array.isArray(v)) return '"' + k + '" must be a list'; if (p.minItems && v.length < p.minItems) return '"' + k + '" needs ' + p.minItems + ' item(s)'; if (p.maxItems && v.length > p.maxItems) return '"' + k + '" has too many items'; for (const x of v) { const e = checkVal(p.items, x, k); if (e) return e; } }
  if ((t === 'integer' || t === 'number') && ((p.minimum != null && v < p.minimum) || (p.maximum != null && v > p.maximum))) return '"' + k + '" is out of range';
  if (p.enum && !p.enum.includes(v)) return '"' + k + '" must be one of ' + p.enum.join(', ');
  return '';
}
