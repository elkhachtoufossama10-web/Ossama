#!/usr/bin/env python3
"""Builds the static data snapshot used by the GitHub Pages version of the app (no server there).

Two public sources send no CORS headers, so the browser cannot read them directly:
  * NOAA Aviation Weather Center bulk METAR cache (official file meant for bulk download):
      https://aviationweather.gov/data/cache/metars.cache.csv.gz
  * Open-Meteo model metadata (ECMWF IFS run time):
      https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json
A scheduled GitHub Actions workflow runs this script every ~20 minutes and publishes the output on the
`data` branch, which the app reads through raw.githubusercontent.com (CORS enabled).

Output (directory given as argv[1]):
  metar/<lat10>_<lon10>.json  stations in each 10°×10° cell, same field names as the AWC JSON API
  model-meta.json             Open-Meteo meta.json for ecmwf_ifs025, unchanged
  index.json                  generation time and counts
Standard library only."""
import csv, gzip, io, json, os, sys, time, urllib.request
from datetime import datetime, timezone

UA = 'earth-observatory-snapshot/0.1 (+https://github.com/elkhachtoufossama10-web/Ossama)'

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # network hiccup: retry with backoff
            if i == tries - 1:
                raise
            print('retry', url, e, file=sys.stderr)
            time.sleep(5 * (i + 1))

def num(s):
    try:
        v = float(s)
        return v if v == v else None
    except (TypeError, ValueError):
        return None

def main(out):
    os.makedirs(os.path.join(out, 'metar'), exist_ok=True)
    raw = gzip.decompress(get('https://aviationweather.gov/data/cache/metars.cache.csv.gz')).decode('utf-8', 'replace')
    rows = list(csv.reader(io.StringIO(raw)))
    head = rows[0]
    idx = {k: head.index(k) for k in ('raw_text', 'station_id', 'observation_time', 'latitude', 'longitude', 'temp_c', 'dewpoint_c',
                                       'wind_dir_degrees', 'wind_speed_kt', 'altim_in_hg', 'sea_level_pressure_mb', 'sky_cover')}
    latest = {}
    for r in rows[1:]:
        if len(r) < len(head) - 5:
            continue
        g = lambda k: r[idx[k]]
        lat, lon = num(g('latitude')), num(g('longitude'))
        if lat is None or lon is None or not g('station_id'):
            continue
        try:
            t = datetime.strptime(g('observation_time'), '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        altim = num(g('altim_in_hg'))
        rec = {
            'icaoId': g('station_id'), 'name': '', 'lat': lat, 'lon': lon, 'obsTime': int(t.timestamp()),
            'temp': num(g('temp_c')), 'dewp': num(g('dewpoint_c')), 'wdir': num(g('wind_dir_degrees')), 'wspd': num(g('wind_speed_kt')),
            # QNH in hPa (as the AWC JSON API reports it); fall back to sea-level pressure
            'altim': round(altim * 33.8639, 1) if altim else num(g('sea_level_pressure_mb')),
            'rawOb': g('raw_text'), 'cover': g('sky_cover'),
        }
        old = latest.get(rec['icaoId'])
        if not old or rec['obsTime'] > old['obsTime']:
            latest[rec['icaoId']] = rec
    tiles = {}
    for rec in latest.values():
        key = f"{int((rec['lat'] + 90) // 10) * 10 - 90}_{int((rec['lon'] + 180) // 10) * 10 - 180}"
        tiles.setdefault(key, []).append(rec)
    for key, recs in tiles.items():
        with open(os.path.join(out, 'metar', key + '.json'), 'w') as f:
            json.dump(sorted(recs, key=lambda x: x['icaoId']), f, separators=(',', ':'))
    meta = get('https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json')
    json.loads(meta)  # must be valid JSON
    with open(os.path.join(out, 'model-meta.json'), 'wb') as f:
        f.write(meta)
    info = {'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'stations': len(latest), 'tiles': len(tiles),
            'sources': ['https://aviationweather.gov/data/cache/metars.cache.csv.gz', 'https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json']}
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'snapshot')
