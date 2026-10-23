#!/usr/bin/env python3
"""Turns dist-artifact/index.html into a Claude Artifact page with the map data embedded inline."""
import json, re, sys
src, out = 'dist-artifact/index.html', 'dist-artifact/oslo-walk.html'
s = open(src, encoding='utf-8').read()
title = re.search(r'<title>.*?</title>', s, re.S).group(0)
head = re.search(r'<head>(.*?)</head>', s, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', s, re.S).group(1)
styles = ''.join(re.findall(r'<style[^>]*>.*?</style>', head, re.S))
scripts = ''.join(re.findall(r'<script[^>]*>.*?</script>', head, re.S))
data = ''
for area in ('karljohan', 'bjorvika', 'akerbrygge', 'central'):
    txt = json.dumps(json.load(open(f'public/data/{area}.json', encoding='utf-8')), ensure_ascii=False, separators=(',', ':'))
    data += f'<script type="application/json" id="data-{area}">{txt.replace("</", "<\\/")}</script>\n'
page = f'{title}\n<meta name="theme-color" content="#0d1420">\n{styles}\n{body.strip()}\n{data}{scripts}'
open(out, 'w', encoding='utf-8').write(page)
print(out, len(page) // 1024, 'KB')
