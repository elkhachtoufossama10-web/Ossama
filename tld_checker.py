#!/usr/bin/env python3
"""
Domain availability checker for .com and any other extension with an official RDAP server.

The RDAP server for each extension comes from IANA's official bootstrap file
(https://data.iana.org/rdap/dns.json), so every answer is from the registry itself
(e.g. Verisign for .com/.net). 200 = TAKEN, 404 = AVAILABLE.
An AVAILABLE answer is only reported after the registry says 404 twice;
anything else (rate limit, timeout, error) is reported as UNKNOWN, never guessed.

Usage:
  python3 tld_checker.py powersi.com enginesi.com          # check full domains
  python3 tld_checker.py -t com,net,ai power engine         # check words on extensions
  python3 tld_checker.py -t com -f words.txt                # bulk from file
  python3 tld_checker.py --count goldkey                    # count how many extensions it is registered on
"""
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BOOTSTRAP = "https://data.iana.org/rdap/dns.json"
# Popular extensions used by --count (only those with an RDAP server are queried)
COUNT_TLDS = ("com net org info biz ai app dev xyz online store tech shop site club live "
              "pro io co me tv cc us uk nl fr ca de eu ch se no fi dk be pl cz sk "
              "nz in jp kr br mx es pt it at").split()

_servers = None


def servers():
    global _servers
    if _servers is None:
        with urllib.request.urlopen(BOOTSTRAP, timeout=20) as r:
            data = json.load(r)
        _servers = {t: s[1][0].rstrip("/") + "/" for s in data["services"] for t in s[0]}
    return _servers


def _query(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/rdap+json", "User-Agent": "Mozilla/5.0 (domain-checker; RDAP)"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:
            if e.code in (404, 200):
                return e.code
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1 + 2 * attempt)
                continue
            return e.code
        except Exception:
            time.sleep(1 + 2 * attempt)
    return None


def check(domain):
    """Return 'taken', 'available', 'unknown' or 'no-rdap'."""
    domain = domain.strip().lower().rstrip(".")
    tld = domain.rsplit(".", 1)[-1]
    base = servers().get(tld)
    if not base:
        return "no-rdap"
    url = base + "domain/" + domain
    code = _query(url)
    if code == 200:
        return "taken"
    if code == 404:
        time.sleep(0.5)
        return "available" if _query(url) == 404 else "unknown"
    return "unknown"


def check_many(domains, workers=8):
    """Parallel across registries, but one request at a time per registry (avoids rate limits)."""
    groups = {}
    for d in domains:
        groups.setdefault(servers().get(d.rsplit(".", 1)[-1], "none"), []).append(d)
    out = {}

    def run(group):
        for d in group:
            out[d] = check(d)
            time.sleep(0.3)

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(run, groups.values()))
    return {d: out[d] for d in domains}


def count_registered(label, tlds=COUNT_TLDS):
    """How many of the popular extensions this label is registered on."""
    doms = [f"{label}.{t}" for t in tlds if t in servers()]
    res = check_many(doms, workers=8)
    taken = sorted(d.split(".", 1)[1] for d, s in res.items() if s == "taken")
    unknown = sorted(d.split(".", 1)[1] for d, s in res.items() if s == "unknown")
    return taken, unknown, len(doms)


def main(a):
    if not a:
        print(__doc__)
        return
    if a[0] == "--count":
        for label in a[1:]:
            taken, unknown, n = count_registered(label)
            print(f"{label}: registered on {len(taken)}/{n} -> {' '.join(taken)}"
                  + (f"  (unknown: {' '.join(unknown)})" if unknown else ""))
        return
    tlds = None
    if a[0] == "-t":
        tlds, a = a[1].split(","), a[2:]
    words = open(a[1]).read().split() if a and a[0] == "-f" else a
    doms = [f"{w}.{t}" for w in words for t in tlds] if tlds else words
    for d, s in check_many(doms).items():
        print(f"{d:45} {s.upper()}")


if __name__ == "__main__":
    main(sys.argv[1:])
