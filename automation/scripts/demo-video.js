/**
 * Renders a demo Short from a fixed script, without the Claude API or any
 * platform credentials, so the look can be checked on a fresh install:
 *   npm run demo-video
 * Output: DATA_DIR/media/demo-lesson.mp4 (+ .jpg poster)
 */
process.env.DATA_DIR = process.env.DATA_DIR || './data';
const video = require('../src/render/video');

const script = {
  title: 'Swing points: pick one timeframe',
  scenes: [
    { type: 'title', heading: 'Why your swing points keep moving', text: 'A one-minute lesson from the Stryker curriculum', narration: 'If two passes over the same chart give you different swing points, the chart is not the problem. Here is the usual cause.', stat: '' },
    { type: 'point', heading: 'Pick one timeframe first', text: 'Switching mid-exercise is the most common reason marks disagree.', narration: 'Pick one timeframe before you mark anything, and do not change it halfway through. Switching timeframes is the single most common reason two passes disagree.', stat: '' },
    { type: 'point', heading: 'A swing is a rule, not a feeling', text: 'A high with lower highs either side. A low with higher lows either side.', narration: 'Define a swing high as a candle with lower highs on both sides, and a swing low the same way. Then mark only what fits the rule.', stat: '' },
    { type: 'stat', heading: 'Candles each side', text: 'Fix the count before you start. Three is a common choice.', narration: 'Decide how many candles each side you require. Three is a common choice. Whatever you pick, keep it for the whole exercise.', stat: '3' },
    { type: 'point', heading: 'Check it on the chart', text: 'Mark ten swings, close the chart, reopen it tomorrow, mark again.', narration: 'Mark ten swings today, close the chart, and mark the same stretch again tomorrow. If they match, your rule is doing the work.', stat: '' },
    { type: 'cta', heading: 'The full chapter is free', text: 'Trend, range and swing points, with exercises.', narration: 'The full chapter on trend, range and swing points is on strykertrading.com. A free account gets you the whole curriculum.', stat: '' }
  ]
};

video.build({ id: 'demo-lesson', kind: 'lesson' }, script, { voice: process.env.VOICE || 'auto', musicDb: -18 })
  .then((r) => { console.log(r); })
  .catch((e) => { console.error(e); process.exit(1); });
