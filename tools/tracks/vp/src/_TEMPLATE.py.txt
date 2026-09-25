#!/usr/bin/env python3
"""VP-00 TEMPLATE (copy to src/<ID>.py). Shows the API only; not a real chapter."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

# 1. Figures: computed from data, never hand-placed.
prices = [5000 + 0.25 * i for i in range(14)]          # low -> high, ES ticks of 0.25
vols = [40, 90, 150, 260, 420, 610, 700, 540, 380, 300, 170, 90, 50, 20]
fig1_svg, (poc, val, vah) = profile(prices, vols, 'Volume profile with POC and value area', dp=2, show_vols=True)
fig1 = figure(fig1_svg, 'Volume at each price. The gold bar is the POC; the shaded band is the 70% value area.')

body = [
    '<p>Opening paragraph that says what the chapter covers and why it matters.</p>',
    '<h3>First section</h3>',
    '<p>Short paragraphs. Define every term the first time it appears.</p>',
    fig1,
    callout('Key idea', '<p>One-sentence takeaway.</p>'),
    table(['Term', 'Meaning'], [['POC', 'price with the most volume']]),
    '<h3>Practice exercises</h3><ol><li>...</li></ol>',
    quiz([('Question?', '<p>Answer with the reason.</p>')]),
]
lessons = [('Lesson title', '<p>Concrete task the student does on a chart.</p>')] * 4
write_chapter('vp', 'VP-00', 'Template', 'intermediate', '25 min', lessons, body,
              [('Source title', 'https://example.com'), ('Source 2', 'https://example.com'), ('Source 3', 'https://example.com')])
