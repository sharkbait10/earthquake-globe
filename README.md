# Earthquake Globe

An interactive 3D globe of the past week's magnitude 2.5+ earthquakes, using the live
[USGS GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson)
and [globe.gl](https://globe.gl).

- Points sized by magnitude, coloured by magnitude or depth (toggle)
- Click a quake for details and a link to its USGS event page
- Minimum-magnitude slider
- Timeline strip: drag to pick a time window, drag inside it to slide it, drag its edges to resize

Plain HTML, CSS and JavaScript. No build step, no backend. Libraries load from jsDelivr at pinned versions.

## Run locally

The page fetches data, so serve it over HTTP rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
