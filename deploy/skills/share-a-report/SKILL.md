---
name: Share a report
description: How to publish a report or dashboard as a page with a secret link.
---
# Sharing a report

Use `publish_page` for one self-contained HTML file. The user approves the first publish. Use `update_page` to change it later: the link stays the same.

- Scripts do not run. Use plain HTML and inline CSS, and tables or inline SVG for charts.
- Put `lang` and `dir="rtl"` on the html tag for Persian.
- Add the date and the source of the numbers.
- Anyone holding the link can read it, so leave out secrets and private data unless the user asked for them.
