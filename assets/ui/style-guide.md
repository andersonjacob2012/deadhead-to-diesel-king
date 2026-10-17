# Deadhead to Diesel King: UI style guide
The look is a gritty retro truck stop: worn chrome and gold on deep navy, Rye western slab lettering and a cocked, jeweled crown. You can see everything rendered in `style-guide.html` (screenshot: `preview/style-guide.png`).

## Color tokens (ui-kit.css; they match index.html :root)
| Token | Hex | Role |
|---|---|---|
| --dk-navy | #0b1220 | app background, outlines |
| --dk-navy2 | #0f1828 | textured backgrounds |
| --dk-surf / --dk-surf2 | #141f35 / #1a2843 | panels, cards / raised or selected |
| --dk-line / --dk-steel | #2a3b5e / #46587a | hairlines / chrome shadow |
| --dk-gold | #ffd84d | primary accent, icons, CTA |
| --dk-gold-hi / --dk-gold-lo | #fff8c4 / #b8942a | gold highlight / bevel and frame |
| --dk-gold-ink | #1a1300 | text on gold |
| --dk-chrome | #9fb0c9 | chrome mids, secondary text |
| --dk-good / --dk-bad / --dk-hot / --dk-blue | #5ee38a / #ff6b6b / #ff5a4a / #7cc4ff | status |
| --dk-ironnavy / --dk-oxblood / --dk-racing | #1d2c4f / #7a1f1f / #14532d | truck make colors (Ironcrest / Bannerline / Highvale) |
| --dk-bronze / --dk-silver / --dk-diamond | #c98a52 / #cfd8e6 / #7cc4ff | badge tiers (plus gold) |

## Type
- **Rye** (OFL, self-hosted `fonts/Rye-Regular.woff2`, 47 KB) is for **display only**: screen and section headers, modal titles, banners. Use it at 18px or larger and never for numbers.
- **Inter** (Google Fonts link, system-ui fallback) is for everything else. Use 800 weight with `tabular-nums` for cash and stats.

## Rules
- Use texture only on big surfaces (backgrounds, panels, the logo). Icons, map markers and chips stay flat.
- There is one gold CTA per view (`.dk-btn--primary`). Secondary buttons are chrome-outlined navy, and danger is red.
- Icons are on a 24px grid with a 2px round stroke in `currentColor`, gold by default. Show them at 18–28px.
- Use the crown sparingly: logo, level ring, active map marker, badges and banners.
- Truck portraits (`trucks/`) are 16:9 on navy. Show them with `object-fit:cover` on a `#0b1220` background so the edges blend in.
- Respect `prefers-reduced-motion`; the kit's animations already turn themselves off.
