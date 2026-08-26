# Deploy checklist

1. Edit files in the repo root.
2. Bump BOTH the asset version and the build number — they must match:
       NEW=127
       for f in *.html; do sed -i "s/?v=126/?v=$NEW/g" "$f"; done
       sed -i "s/content=\"126\"/content=\"$NEW\"/" *.html
       echo "{\"build\": $NEW}" > assets/version.json
3. Validate:
       python3 tools/check.py
4. Set git identity (fresh containers have none; the commit fails silently otherwise):
       git config user.email "theelitegrey@gmail.com"
       git config user.name "Stryker"
5. Commit and push:
       git add -A && git commit -F /tmp/msg.txt && git push origin main
   Use -F with a message file. Inline -m breaks on quotes and backticks.
6. Poll the build (curl against strykertrading.com always 403s — bot blocking,
   never use it to verify a deploy):
       curl -s -H "Authorization: Bearer $GH_TOKEN" \
         -H "Accept: application/vnd.github+json" \
         https://api.github.com/repos/theelitegrey/Stryker-trading-academy-/pages/builds/latest
   Wait for status=built on the new commit SHA.

## Why the build number exists

?v= versions the assets a page references, never the page itself — HTML is
fetched at a bare URL. GitHub Pages serves it with max-age=600 and mobile
browsers hold it far longer, so visitors can sit on very old markup while
every asset is current.

That caused two incidents: a student stuck on a login page whose role toggle
had been removed, and stale admin sidebars after the accordion shipped.

assets/version-check.js fetches version.json uncached and compares it to the
page's stryker-build meta, reloading once if the page is behind. If the two
ever drift apart, either everyone reloads forever or nobody recovers — so
tools/check.py fails the deploy when they disagree.

## Cloudflare Pages notes (post-migration)

- The deploy flow is unchanged: push to main, Cloudflare Pages builds it
  (build command: none, output dir: /). The GitHub Pages build-poll step
  above no longer proves anything once DNS points at Cloudflare — check
  the deployment in the Cloudflare dashboard instead.
- CRITICAL: preview deployments must stay OFF for this project. The
  monitor-data workflow force-pushes the `data` branch every 20 minutes;
  with previews on, each push consumes one of the 500 free builds/month
  and the quota dies in under a week.
- _headers gives assets a year-long cache (safe: every change bumps ?v=)
  and forces HTML to revalidate, so the stryker-build reload loop should
  almost never trigger there.
- Keep the ?v=/version.json bump discipline anyway: it stays correct on
  any host, and GitHub Pages remains the fallback if DNS ever moves back.
