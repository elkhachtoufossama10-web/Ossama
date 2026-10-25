#!/usr/bin/env python3
"""Extracts verified NASA GIBS layer metadata (tile matrix set, format, legend, time coverage)
from the official WMTS GetCapabilities document into src/sources/gibs-layers.json.
Usage: python3 scripts/gibs_layers.py capabilities.xml   (EPSG:3857 'best' endpoint)"""
import json, re, sys
WANT = {
  'BlueMarble_ShadedRelief_Bathymetry': 'base', 'VIIRS_Black_Marble': 'night', 'VIIRS_SNPP_CorrectedReflectance_TrueColor': 'observation',
  'ASTER_GDEM_Greyscale_Shaded_Relief': 'base', 'Reference_Features_15m': 'reference', 'Reference_Labels_15m': 'reference', 'Coastlines_15m': 'reference',
  'AIRS_L2_Surface_Air_Temperature_Day': 'retrieval', 'AIRS_L2_Surface_Air_Temperature_Night': 'retrieval',
  'AIRS_L2_Surface_Relative_Humidity_Day': 'retrieval', 'MODIS_Terra_Cloud_Fraction_Day': 'retrieval',
  'IMERG_Precipitation_Rate_30min': 'analysis', 'MERRA2_2m_Air_Temperature_Monthly': 'reanalysis',
}
s = open(sys.argv[1]).read()
out = {}
for ident, kind in WANT.items():
    i = s.find('<ows:Identifier>%s</ows:Identifier>' % ident)
    if i < 0:
        print('missing', ident); continue
    L = s[s.rfind('<Layer>', 0, i):s.find('</Layer>', i)]
    tms = re.search(r'<TileMatrixSet>(.*?)</TileMatrixSet>', L).group(1)
    fmt = re.search(r'<Format>(.*?)</Format>', L).group(1)
    leg = re.search(r"LegendURL xlink:href='([^']+_H\.svg)'", L)
    dim = re.search(r'<Dimension>(.*?)</Dimension>', L, re.S)
    rec = {'id': ident, 'title': re.search(r"<ows:Title xml:lang='en'>(.*?)</ows:Title>", L).group(1), 'kind': kind,
           'tms': tms, 'maxLevel': int(tms.split('Level')[-1]), 'ext': 'png' if 'png' in fmt else 'jpg', 'legend': leg.group(1) if leg else None}
    if dim:
        vals = re.findall(r'<Value>(.*?)</Value>', dim.group(1))
        rec['default'] = re.search(r'<Default>(.*?)</Default>', dim.group(1)).group(1)
        rec['period'] = vals[-1].split('/')[-1]
        rec['start'] = vals[0].split('/')[0]
        rec['end'] = vals[-1].split('/')[1]
    out[ident] = rec
json.dump(out, open('src/sources/gibs-layers.json', 'w'), indent=1)
print(len(out), 'layers')
