---
title: Error and warning codes
dek: Every message the engine can give, in plain words.
---
Each message has a code, a line and column, and often a hint. Words in {braces} are filled in with your own names and numbers.

## Lexer / header

| Code | Meaning |
|---|---|
| E101 | Unexpected character `{c}`. |
| E102 | Unterminated string (closing quote missing). |
| E103 | Bad color literal `{text}` (use #RRGGBB or #RRGGBBAA). |
| E104 | Bad number `{text}`. |
| E105 | Indentation does not match any outer block. |
| E106 | Source is too large (limit 256 KB). |
| E201 | Missing header. Hint: put `//@zscript 1` on the first line. |
| E202 | Unsupported version `{n}`. Hint: use `//@zscript 1`. |
| E203 | Unexpected `{token}`, expected {what}. |
| E204 | Missing closing `)` / `]`. |
| E205 | Expected an indented block after `{kw}`. |
| E206 | `=>` default case must be last in switch. |
| E207 | Nesting too deep (limit 128). |
| E208 | `break`/`continue` outside a loop. |
| E209 | `=` used in a condition. Hint: use `==` to compare, `:=` to reassign. |
| E210 | Reserved word `{w}` cannot be used here. |

## Checker

| Code | Meaning |
|---|---|
| E301 | Missing `indicator(...)` declaration. Hint: add `indicator("My script")` after the header. |
| E302 | `indicator()` declared twice. |
| E303 | Unknown name `{x}`. Hint: Did you mean `{y}`? |
| E304 | Unknown function `{f}`. Hint: Did you mean `{g}`? |
| E305 | `{x}` is already declared in this scope. Hint: use `:=` to change it. |
| E306 | Cannot reassign `{x}` with `:=` before it is declared. Hint: declare it with `=` first. |
| E307 | `{f}` expects {n} arguments, got {m}. |
| E308 | `{f}` has no parameter named `{p}`. Hint: Did you mean `{q}`? |
| E309 | Argument `{p}` of `{f}` must be {type}, got {type2}. |
| E310 | Cannot assign {type} to `{x}` declared as {type2}. |
| E311 | `{x}` is {type}; cannot assign {type2}. |
| E312 | Operator `{op}` cannot be used with {type} and {type2}. |
| E313 | Condition must be bool or number, got {type}. |
| E314 | Tuple has {n} values but {m} names. |
| E315 | `{x}` is not a function. |
| E316 | History `[]` needs a number of bars, got {type}. |
| E317 | Built-in `{x}` cannot be reassigned. |
| E318 | Function `{f}` calls itself (recursion is not allowed). |
| E319 | Functions must be defined at top level. |
| E320 | Method `{m}` does not exist for {type}. Hint: Did you mean `{n}`? |
| E321 | Positional argument after a named one. |
| E322 | Function `{f}` declared twice. |
| E330 | Inputs must be called at top level with a literal default. |
| E340 | `{f}` must be called at top level (not inside if/for/functions). |
| E341 | Too many plots (limit 64). |
| E350 | request.security expression uses the script variable `{x}`. Hint: compute it inside the expression, or move it into a function. |
| E351 | lookahead is not allowed. |
| E352 | Timeframe `{tf}` is lower than the chart timeframe. |
| E353 | Too many request.security calls (limit 16). |
| W101 | `{f}` is called only on some bars (inside `if`), so its state skips the other bars. Hint: compute it at top level and use the result inside the `if`. |
| W102 | `{f}` inside a loop shares one state for every iteration. |
| W103 | Variable `{x}` is never used. |

## Runtime

| Code | Meaning |
|---|---|
| E401 | Script took longer than 20 s. |
| E402 | History `[{n}]` is beyond max_bars_back ({m}). Hint: raise max_bars_back in indicator(). |
| E403 | Too many operations on one bar (limit 1,000,000). Hint: a loop may be too large. |
| E404 | Loop ran more than 100,000 times on one bar. |
| E405 | Array too large (limit 100,000 items) / too many items in all arrays (1,000,000). |
| E406 | Map too large (limit 50,000 keys). |
| E407 | String too long (limit 4,096). |
| E408 | Too many {kind} drawings is not an error: oldest is removed. (Tables over 20 -> E408.) |
| E409 | Division by zero is NOT an error: result is na. |
| E410 | Index {i} out of range for array of size {n}. |
| E411 | Called a method on na (`{what}`). |
| E412 | `{f}` length must be a positive number, got {v}. |
| E413 | Too many bars (limit 50,000). |
| E414 | Function calls nested too deep (limit 64). |
| E415 | request.security data for {sym} {tf} is not available (warning-level notice, value na). |
| E499 | Internal engine error (report this script to support). |
