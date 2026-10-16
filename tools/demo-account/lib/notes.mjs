// Human-sounding trade notes, composed from phrase pools so no two journal entries repeat.
// Only references facts that are true of the trade itself (level names, direction, points, R).
const L = {
  long: ['Asia low', 'London low', 'previous day low', 'the 9:30 low', 'overnight low', 'sell-side below the 8:00 low', 'equal lows'],
  short: ['Asia high', 'London high', 'previous day high', 'the 9:30 high', 'overnight high', 'buy-side above the 8:00 high', 'equal highs']
};
const SET = {
  'ICT 2022': [
    'Swept {lvl}, MSS with displacement on the 1m, entered the FVG on the retrace.',
    'Bias was {bias} from the HTF. {lvl} got taken, then a clean shift and I took the first PD array.',
    'Full model: sweep of {lvl}, displacement, FVG entry, stop behind the sweep.',
    'Waited for the shift after {lvl} was run. Entry at the gap, stop tight.'
  ],
  'Liquidity Sweep': [
    '{Lvl} got raided and price snapped back inside within a couple of candles.',
    'Sweep of {lvl} with a quick rejection wick. Entered on the close back inside.',
    'Stops under/over {lvl} were obvious. Let them get taken first, then went with the reversal.',
    'Reclaimed {lvl} straight away, took it on the first pullback.'
  ],
  'IFVG': [
    'Price closed through the 5m gap the wrong way, that made it an IFVG. Entered the retest.',
    'IFVG after the sweep of {lvl}. Waited for the body close outside the gap.',
    'Old FVG got inverted on a strong close, took the retest with the stop just beyond the gap.',
    'Clean inversion of the gap right at the open, retest gave the entry.'
  ],
  'FVG': [
    'Continuation, {bias} bias. Took the first 5m FVG that held on the pullback.',
    'Displacement left a gap, price came back to the midpoint and I entered there.',
    'FVG entry with the stop beyond the candle that created it.',
    'Gap fill and go. Nothing fancy, just the model.'
  ],
  'ORB': [
    'Opening range break after the first 5m candle, entered on the retest of the level.',
    'Marked the opening range, waited for a body close beyond it before getting involved.',
    'ORB, stop on the other side of the range, target at the marked liquidity.',
    'Range break with volume behind it. One shot, no re-entries.'
  ],
  'MSS': [
    'Market structure shift on the 1m after {lvl} was taken. Entered the pullback.',
    'Shift in structure after the run on {lvl}. Stop above the swing.',
    'MSS confirmed, waited for the retrace instead of chasing the candle.',
    'Structure broke the other way after {lvl}, took the first pullback.'
  ],
  'Silver Bullet': [
    'Silver Bullet window. Sweep, then the first FVG against it, entered at the near edge.',
    'Inside the 10:00 hour, first gap after the sweep of {lvl}. Target the other side of the range.',
    'Took the window trade, stop beyond the sweep, flat after.',
    'One Silver Bullet attempt, kept to the window.'
  ],
  'Order Block': [
    'Came back into the order block after taking {lvl}. Small stop under the block.',
    'OB retest in discount, entered on the first reaction.',
    'Block held on the retest, stop just beyond it.',
    'Mitigation of the block at the 50%, entered there.'
  ]
};
const WIN_OPEN = ['Clean.', 'Patient entry.', 'Exactly what I planned.', 'Good one.', 'No hesitation on this.', 'Felt calm taking it.', 'Followed the plan.', 'Easy trade to manage.', 'Took it and left it alone.', 'One of the better ones this week.', 'Waited for it.', 'Did not overthink it.'];
const WIN_END = ['Held to target.', 'Moved the stop to break even once it ran, then let it go.', 'Took the target and walked away.', 'Closed it near the high of the move.', 'Could have held longer but I took the money.', 'Took most of it off at {r}R.', 'Out at the level I had marked before the open.', 'Target was the next pool of liquidity and it got there.', 'Trailed behind the last candle low for the final bit.', 'Banked {pts} points and stopped for the day.', 'Stayed disciplined and did not add.', 'Closed {r}R, risk was where I planned it.'];
const LOSS_OPEN = ['Stopped out.', 'Not my best.', 'Took the loss.', 'Wrong read.', 'Price just did not respect it.', 'Fine loss, stop was where it should be.', 'Annoying one.', 'Back through the level straight away.', 'Reversed hard after my entry.', 'Lost this one.', 'Small loss, moving on.'];
const LOSS_END = ['Risk was defined, no drama.', 'Stop hit for -{r}R. Next.', 'Entry was a touch early, should have waited for the close.', 'Chop with no follow-through.', 'Candle after candle of nothing then the stop.', 'News spike took it out.', 'Spread of the move was too slow, it lost the momentum.', 'The HTF was against it and I knew it.', 'No second attempt, done.', 'Cut it early rather than let it hit the full stop.', 'Lunch-hour chop, should not have been trading it.', 'Reviewing the entry later, the confirmation was thin.', 'Lost {pts} points on it, size was right.'];
const TILT = ['Took this right after the last loss, not a real setup.', 'Revenge entry, I knew it as I clicked.', 'Chased it. Rule broken.', 'Should have stopped for the day after the second loss.', 'Forced it because I missed the first move.'];
const FOMO = ['Late, the move was already underway.', 'Saw it running and jumped in. Poor location.'];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function makeNote(rn, t, used) {
  // t: { setup, dir, win, r, pts, tilt, fomo }
  for (let tries = 0; tries < 40; tries++) {
    const lvl = rn.pick(L[t.dir]);
    const fill = (s) => s.replace('{lvl}', lvl).replace('{Lvl}', cap(lvl)).replace('{bias}', t.dir === 'long' ? 'bullish' : 'bearish')
      .replace('{r}', Math.abs(t.r).toFixed(1)).replace('{pts}', Math.abs(t.pts).toFixed(t.pts % 1 ? 1 : 0));
    const mid = fill(rn.pick(SET[t.setup] || SET['FVG']));
    let parts;
    if (t.tilt) parts = [rn.pick(TILT), mid, fill(rn.pick(LOSS_END))];
    else if (t.fomo) parts = [rn.pick(FOMO), mid, fill(rn.pick(t.win ? WIN_END : LOSS_END))];
    else if (t.win) parts = rn.chance(0.55) ? [rn.pick(WIN_OPEN), mid, fill(rn.pick(WIN_END))] : [mid, fill(rn.pick(WIN_END))];
    else parts = rn.chance(0.5) ? [rn.pick(LOSS_OPEN), mid, fill(rn.pick(LOSS_END))] : [mid, fill(rn.pick(LOSS_END))];
    if (rn.chance(0.3)) parts.splice(rn.int(0, parts.length - 1), 1);   // vary length
    const s = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!used.has(s)) { used.add(s); return s; }
  }
  const s = 'Logged after the session. ' + used.size; used.add(s); return s;
}
