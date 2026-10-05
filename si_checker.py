#!/usr/bin/env python3
"""
.si domain availability checker.

Sources (official registry for .si, run by ARNES / register.si):
  1. RDAP  https://rdap.register.si/domain/<name>.si   (listed in IANA's RDAP bootstrap)
       200 -> TAKEN, 404 -> AVAILABLE
  2. WHOIS whois.register.si:43 (cross-check / fallback)

If the sources disagree or cannot be reached, the result is UNKNOWN - never a guess.

Usage:
  python3 si_checker.py                 # web app on http://127.0.0.1:8000
  python3 si_checker.py word1 word2 ... # command line
  python3 si_checker.py -f words.txt    # bulk from file (one per line)
Only the Python standard library is required.
"""
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

RDAP_URL = "https://rdap.register.si/domain/{}"
WHOIS_HOST = "whois.register.si"
LABEL_RE = re.compile(r"^(?!-)(?!..--)[a-z0-9-]{1,63}(?<!-)$")
MAX_WORKERS = 3  # be polite to the registry; it rate-limits


def normalize(word):
    w = word.strip().lower()
    if w.endswith(".si"):
        w = w[:-3]
    if not w:
        return None, "empty"
    try:
        w = w.encode("idna").decode("ascii")  # supports č, š, ž (IDN)
    except UnicodeError:
        return None, "invalid characters"
    if "." in w or not LABEL_RE.match(w):
        return None, "invalid domain label"
    if len(w) < 2:
        return None, "too short"
    return w + ".si", None


def rdap(domain):
    """Return 'taken', 'available' or None (unknown)."""
    for attempt in range(4):
        req = urllib.request.Request(RDAP_URL.format(domain),
                                     headers={"Accept": "application/rdap+json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read() or b"{}")
                if r.status == 200 and data.get("ldhName", "").lower().rstrip(".") == domain:
                    return "taken"
                return "taken" if r.status == 200 else None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "available"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            return None
        except Exception:
            time.sleep(2 ** attempt)
    return None


def whois(domain):
    """Return 'taken', 'available' or None (unknown)."""
    for attempt in range(3):
        try:
            with socket.create_connection((WHOIS_HOST, 43), timeout=15) as s:
                s.sendall((domain + "\r\n").encode())
                buf = b""
                while chunk := s.recv(4096):
                    buf += chunk
            text = buf.decode("utf-8", "replace").lower()
            if "no entries found" in text or "not found" in text:
                return "available"
            if "domain:" in text and "registrar:" in text:
                return "taken"
            if "limit" in text or "exceeded" in text:
                time.sleep(2 ** attempt)
                continue
            return None
        except Exception:
            time.sleep(2 ** attempt)
    return None


def check(word):
    domain, err = normalize(word)
    if err:
        return {"input": word, "domain": None, "status": "invalid", "detail": err}
    r = rdap(domain)
    w = whois(domain)
    if r and w and r != w:
        status, detail = "unknown", f"sources disagree (RDAP={r}, WHOIS={w})"
    elif r or w:
        status = r or w
        detail = "RDAP + WHOIS agree" if (r and w) else ("RDAP only" if r else "WHOIS only")
    else:
        status, detail = "unknown", "registry unreachable - try again"
    return {"input": word, "domain": domain, "status": status, "detail": detail,
            "rdap": r, "whois": w}


def check_many(words):
    words = [w for w in dict.fromkeys(x.strip() for x in words) if w]
    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        return list(ex.map(check, words))


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>.si Checker</title>
<style>
body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;background:#f7f7f8;color:#111}
textarea{width:100%;height:160px;font:15px monospace;padding:8px;box-sizing:border-box}
button{padding:10px 20px;font-size:15px;margin-top:8px;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:1rem;background:#fff}
td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left;font-size:14px}
.available{color:#0a7d2c;font-weight:700}.taken{color:#c0262d;font-weight:700}
.unknown,.invalid{color:#a66b00;font-weight:700}small{color:#666}
</style></head><body>
<h1>.si domain checker</h1>
<p><small>Live lookup against the official .si registry (register.si) via RDAP, cross-checked with WHOIS.</small></p>
<textarea id="w" placeholder="one word per line (or comma separated)&#10;example&#10;mojadomena"></textarea>
<button onclick="go()">Check</button> <button onclick="csv()">Export CSV</button> <span id="s"></span>
<table id="t"></table>
<script>
let rows=[];
async function go(){
 const words=document.getElementById('w').value.split(/[\\n,;\\s]+/).filter(Boolean);
 if(!words.length)return; rows=[]; const t=document.getElementById('t');
 t.innerHTML='<tr><th>Domain</th><th>Status</th><th>Source</th></tr>';
 for(let i=0;i<words.length;i++){
  document.getElementById('s').textContent=`checking ${i+1}/${words.length}...`;
  const r=await (await fetch('/api/check?w='+encodeURIComponent(words[i]))).json();
  rows.push(r);
  t.insertRow().innerHTML=`<td>${r.domain||r.input}</td><td class="${r.status}">${r.status.toUpperCase()}</td><td><small>${r.detail}</small></td>`;
 }
 document.getElementById('s').textContent='done';
}
function csv(){
 const c='domain,status,detail\\n'+rows.map(r=>[r.domain||r.input,r.status,r.detail].join(',')).join('\\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c]));a.download='si-results.csv';a.click();
}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/check":
            word = parse_qs(u.query).get("w", [""])[0]
            body, ctype = json.dumps(check(word)).encode(), "application/json"
        elif u.path == "/":
            body, ctype = PAGE.encode(), "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def main(argv):
    if not argv:
        print("Open http://127.0.0.1:8000  (Ctrl+C to stop)")
        ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
    words = open(argv[1], encoding="utf-8").read().split() if argv[0] == "-f" else argv
    for r in check_many(words):
        print(f"{(r['domain'] or r['input']):40} {r['status'].upper():10} {r['detail']}")


if __name__ == "__main__":
    main(sys.argv[1:])
