# Earthquake Globe

An interactive 3D globe of recent magnitude 2.5+ earthquakes, using the live
[USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
and [globe.gl](https://globe.gl).

- Switch between the past hour, day, week and month (your choice is remembered)
- Auto-refreshes as often as USGS updates the feed (every minute; every 15 minutes for the month view), pausing while the tab is hidden
- Quakes that happened since your last visit are marked with a ring on the globe, a dot on the timeline and a badge in their details
- Tectonic plate boundaries (on by default, can be switched off), with subduction zones highlighted and a live count of how many quakes lie within 250 km of a boundary. Data: Peter Bird (2003), [An updated digital model of plate boundaries](https://doi.org/10.1029/2001GC000252), converted by Hugo Ahlenius / Nordpil ([fraxen/tectonicplates](https://github.com/fraxen/tectonicplates)), ODC-BY 1.0
- Hazard layers from [NASA EONET](https://eonet.gsfc.nasa.gov/), each toggled on and off: volcanoes erupting now, wildfires active in the past 30 days (mostly US incidents in EONET), and storms with their tracks. Click a marker for details and source links
- Points sized by magnitude, coloured by magnitude or depth (toggle)
- Click a quake for details and a link to its USGS event page
- Minimum-magnitude slider
- Timeline strip: drag to pick a time window, drag inside it to slide it, drag its edges to resize

Plain HTML, CSS and JavaScript. No build step, no backend. Libraries load from jsDelivr at pinned versions.

When you change `style.css`, `app.js`, `plates.js` or `hazards.js`, bump the `?v=` number on their links in `index.html` so visitors don't get a mix of cached old files and new ones.

## Run locally

The page fetches data, so serve it over HTTP rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
