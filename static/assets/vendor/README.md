# Pinned browser dependencies

The site serves these files from its own hosting so a public CDN failure cannot
interrupt navigation, map initialization or admin styles.

| Library | Version | Distribution | License |
| --- | --- | --- | --- |
| Tailwind browser runtime | 3.4.17 | https://cdn.tailwindcss.com/3.4.17 | MIT, tailwind-LICENSE |
| Lucide UMD | 1.51.0 | https://unpkg.com/lucide@1.51.0/dist/umd/lucide.min.js | ISC, lucide-LICENSE |
| Leaflet | 1.9.4 | https://unpkg.com/leaflet@1.9.4/dist/ | BSD-2-Clause, leaflet-1.9.4/LICENSE |

These versions preserve the libraries used in the accepted visual baseline.
Tailwind still handles dynamic admin class names in the browser; converting it
to precompiled CSS is a separate change requiring full dynamic-style coverage.
Leaflet images are included. Map tiles, real route services, CloudBase and optional
remote fonts still require a network connection; this is not offline map support.
