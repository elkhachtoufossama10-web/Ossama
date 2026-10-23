#!/usr/bin/env python3
"""
Converts raw OpenStreetMap extracts (downloaded from api.openstreetmap.org/api/0.6/map)
into compact JSON files the app loads at runtime (public/data/<area>.json).

Geometry is projected to local metres around each area's centre:
  x = east, z = south (Three.js convention: -z is north).

Data © OpenStreetMap contributors, available under the Open Database License (ODbL).

Usage: python3 scripts/build_osm.py <dir-with-.osm-files> public/data
Needs: shapely (pip install shapely)
"""
import json
import math
import os
import sys
import xml.etree.ElementTree as ET

from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import linemerge, polygonize, unary_union

AREAS = {
    "karljohan": {
        "title": "Karl Johans gate",
        "bbox": (10.7265, 59.9110, 10.7480, 59.9165),
        "spawn": (59.91327, 10.74040),   # Egertorget
        "look": (59.91700, 10.72750),    # towards the Royal Palace
    },
    "bjorvika": {
        "title": "Bjørvika & the Opera",
        "bbox": (10.7480, 59.9040, 10.7620, 59.9105),
        "spawn": (59.90805, 10.75030),
        "look": (59.90750, 10.75350),    # Oslo Opera House
    },
    "akerbrygge": {
        "title": "Aker Brygge",
        "bbox": (10.7215, 59.9070, 10.7330, 59.9125),
        "spawn": (59.91050, 10.72830),
        "look": (59.90900, 10.72650),
    },
    "central": {
        "title": "Jernbanetorget & central streets",
        "bbox": (10.7480, 59.9105, 10.7580, 59.9160),
        "spawn": (59.91205, 10.75030),   # Jernbanetorget
        "look": (59.91330, 10.75200),
    },
}

ROAD_W = {"motorway": 12, "trunk": 10, "primary": 9, "secondary": 8, "tertiary": 7,
          "unclassified": 6, "residential": 6, "living_street": 5, "service": 4.5,
          "trunk_link": 6, "primary_link": 6, "secondary_link": 6, "tertiary_link": 5}
PATH_W = {"pedestrian": 8, "footway": 2.6, "path": 2, "cycleway": 2.2, "steps": 2.6, "corridor": 2}
DEFAULT_H = {"office": 21, "apartments": 18, "retail": 14, "commercial": 18, "hotel": 22,
             "church": 18, "cathedral": 22, "public": 16, "civic": 16, "government": 18,
             "university": 16, "train_station": 14, "roof": 5, "kiosk": 3.5, "garage": 4,
             "house": 9, "yes": 15}


def r1(v):
    return round(v, 2)


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    index = []
    for key, cfg in AREAS.items():
        path = os.path.join(src, key + ".osm")
        if not os.path.exists(path):
            print("missing", path)
            continue
        data = convert(path, cfg)
        with open(os.path.join(dst, key + ".json"), "w") as f:
            json.dump(data, f, separators=(",", ":"))
        index.append({"id": key, "title": cfg["title"],
                      "buildings": len(data["buildings"]), "estimatedHeights": data["stats"]["estimated"]})
        print(key, data["stats"])
    with open(os.path.join(dst, "index.json"), "w") as f:
        json.dump(index, f, indent=1)


def convert(path, cfg):
    root = ET.parse(path).getroot()
    lon0 = (cfg["bbox"][0] + cfg["bbox"][2]) / 2
    lat0 = (cfg["bbox"][1] + cfg["bbox"][3]) / 2
    kx = math.cos(math.radians(lat0)) * 111320.0
    kz = 110540.0

    def proj(lat, lon):
        return ((lon - lon0) * kx, -(lat - lat0) * kz)

    nodes, node_tags = {}, {}
    for n in root.iter("node"):
        nid = n.get("id")
        nodes[nid] = proj(float(n.get("lat")), float(n.get("lon")))
        tg = {t.get("k"): t.get("v") for t in n.iter("tag")}
        if tg:
            node_tags[nid] = tg
    ways = {}
    for w in root.iter("way"):
        refs = [nd.get("ref") for nd in w.iter("nd")]
        pts = [nodes[r] for r in refs if r in nodes]
        tg = {t.get("k"): t.get("v") for t in w.iter("tag")}
        ways[w.get("id")] = (pts, tg, refs)
    rels = []
    for r in root.iter("relation"):
        tg = {t.get("k"): t.get("v") for t in r.iter("tag")}
        mem = [(m.get("type"), m.get("ref"), m.get("role")) for m in r.iter("member")]
        rels.append((tg, mem))

    x0, z1 = proj(cfg["bbox"][1], cfg["bbox"][0])
    x1, z0 = proj(cfg["bbox"][3], cfg["bbox"][2])
    bounds = box(x0, z0, x1, z1)
    clip = bounds.buffer(60)  # keep a margin of context outside the walkable box

    out = {"title": cfg["title"], "bounds": [r1(x0), r1(z0), r1(x1), r1(z1)],
           "buildings": [], "roads": [], "paths": [], "areas": [], "water": [], "land": [],
           "trees": [], "benches": [], "lamps": [], "signals": [], "labels": [],
           "attribution": "© OpenStreetMap contributors (ODbL)"}
    sx, sz = proj(*cfg["spawn"])
    lx, lz = proj(*cfg["look"])
    out["spawn"] = [r1(sx), r1(sz), round(math.atan2(-(lx - sx), -(lz - sz)), 3)]

    def poly_from(pts):
        if len(pts) < 4:
            return None
        try:
            p = Polygon(pts)
            if not p.is_valid:
                p = p.buffer(0)
            return p if p.area > 1 else None
        except Exception:
            return None

    def ring(p):
        return [[r1(x), r1(z)] for x, z in list(p.exterior.coords)[:-1]]

    def emit_polys(geom, fn):
        if geom is None or geom.is_empty:
            return
        geoms = getattr(geom, "geoms", [geom])
        for g in geoms:
            if g.geom_type == "Polygon" and g.area > 1:
                fn(g)

    # ---------- buildings (+ building:part, + multipolygons) ----------
    stats = {"buildings": 0, "estimated": 0}
    part_ways = [wid for wid, (_, tg, _) in ways.items() if "building:part" in tg]
    part_polys = [poly_from(ways[w][0]) for w in part_ways]
    part_polys = [p for p in part_polys if p is not None]

    def height_of(tg):
        est = False
        h = None
        try:
            if "height" in tg:
                h = float(tg["height"].replace("m", "").strip())
        except ValueError:
            h = None
        if h is None and "building:levels" in tg:
            try:
                h = float(tg["building:levels"]) * 3.4 + float(tg.get("roof:levels", 0) or 0) * 2.5
            except ValueError:
                h = None
        if h is None:
            est = True
            kind = tg.get("building", tg.get("building:part", "yes"))
            h = DEFAULT_H.get(kind, 15)
        mh = 0.0
        try:
            if "min_height" in tg:
                mh = float(tg["min_height"].replace("m", ""))
            elif "building:min_level" in tg:
                mh = float(tg["building:min_level"]) * 3.4
        except ValueError:
            pass
        return h, mh, est

    def add_building(poly, tg, holes=()):
        if not poly.intersects(clip):
            return
        h, mh, est = height_of(tg)
        if h - mh < 0.5:
            return
        b = {"p": ring(poly), "h": r1(h), "k": tg.get("building", tg.get("building:part", "yes"))}
        if mh > 0:
            b["mh"] = r1(mh)
        if est:
            b["e"] = 1
            stats["estimated"] += 1
        for key in ("building:colour", "building:material", "roof:shape", "name"):
            if key in tg:
                b[key.split(":")[-1][:4]] = tg[key]
        hs = [ring(Polygon(hh)) for hh in holes] + [[[r1(x), r1(z)] for x, z in list(i.coords)[:-1]] for i in poly.interiors]
        if hs:
            b["holes"] = hs
        out["buildings"].append(b)
        stats["buildings"] += 1

    outlines = []
    for wid, (pts, tg, refs) in ways.items():
        if "building" in tg and "building:part" not in tg and refs and refs[0] == refs[-1]:
            op = poly_from(pts)
            if op is not None:
                outlines.append((op, tg))
    for wid, (pts, tg, refs) in ways.items():
        if "building:part" in tg:
            p = poly_from(pts)
            if p:
                # parts inherit name / material / colour from the building that contains them
                c = p.representative_point()
                for op, otg in outlines:
                    if op.contains(c):
                        tg = dict(tg)
                        for k in ("name", "building:material", "building:colour"):
                            if k not in tg and k in otg:
                                tg[k] = otg[k]
                        break
                add_building(p, tg)
        elif "building" in tg and refs and refs[0] == refs[-1]:
            p = poly_from(pts)
            if not p:
                continue
            # 3D-tagging rule: if parts cover the outline, the parts describe the building
            covered = sum(pp.intersection(p).area for pp in part_polys if pp.intersects(p))
            if covered > 0.6 * p.area:
                continue
            add_building(p, tg)

    for tg, mem in rels:
        if tg.get("type") == "multipolygon" and ("building" in tg or "building:part" in tg):
            outers = [ways[ref][0] for t, ref, role in mem if t == "way" and role == "outer" and ref in ways]
            inners = [ways[ref][0] for t, ref, role in mem if t == "way" and role == "inner" and ref in ways]
            olines = [LineString(o) for o in outers if len(o) > 1]
            ilines = [LineString(i) for i in inners if len(i) > 1]
            for op in polygonize(linemerge(olines)) if olines else []:
                holes = [list(ip.exterior.coords) for ip in polygonize(linemerge(ilines))] if ilines else []
                holes = [hh for hh in holes if Polygon(hh).within(op)]
                add_building(op, tg, holes)

    # ---------- linear ways ----------
    for wid, (pts, tg, refs) in ways.items():
        if len(pts) < 2:
            continue
        hw = tg.get("highway")
        closed = refs and refs[0] == refs[-1]
        line = LineString(pts)
        if not line.intersects(clip):
            continue
        if hw and (tg.get("area") == "yes" and closed):
            p = poly_from(pts)
            emit_polys(p, lambda g: out["areas"].append({"t": "plaza", "p": ring(g)}))
            continue
        if hw in ROAD_W:
            w = ROAD_W[hw]
            try:
                if "lanes" in tg:
                    w = max(w, float(tg["lanes"]) * 3.25)
                if "width" in tg:
                    w = float(tg["width"].replace("m", ""))
            except ValueError:
                pass
            if tg.get("tunnel") in ("yes", "building_passage") or tg.get("layer", "0").startswith("-"):
                continue
            rec = {"p": [[r1(x), r1(z)] for x, z in pts], "t": hw, "w": r1(w)}
            if tg.get("bridge") == "yes":
                rec["br"] = 1
            if "name" in tg:
                rec["n"] = tg["name"]
            out["roads"].append(rec)
        elif hw in PATH_W:
            if tg.get("tunnel") == "yes" or tg.get("layer", "0").startswith("-") or tg.get("indoor") == "yes":
                continue
            w = PATH_W[hw]
            try:
                if "width" in tg:
                    w = float(tg["width"].replace("m", ""))
            except ValueError:
                pass
            rec = {"p": [[r1(x), r1(z)] for x, z in pts], "t": hw, "w": r1(min(w, 30))}
            if "name" in tg:
                rec["n"] = tg["name"]
            out["paths"].append(rec)
        elif tg.get("railway") == "tram" and not tg.get("tunnel"):
            out["roads"].append({"p": [[r1(x), r1(z)] for x, z in pts], "t": "tram", "w": 2.8})

        # areas
        if closed:
            a = None
            if tg.get("area:highway") in ("pedestrian", "footway") or tg.get("place") == "square":
                a = "plaza"
            elif tg.get("landuse") in ("grass", "flowerbed") or tg.get("leisure") in ("park", "garden") or tg.get("natural") in ("scrub", "grassland"):
                a = "grass"
            elif tg.get("man_made") == "pier":
                a = "pier"
            elif tg.get("natural") == "water" or tg.get("water") or tg.get("waterway") == "dock":
                a = "water"
            if a:
                p = poly_from(pts)
                if p is not None:
                    p = p.intersection(clip)
                    if a == "water":
                        emit_polys(p, lambda g: out["water"].append(ring(g)))
                    else:
                        emit_polys(p, lambda g, a=a: out["areas"].append({"t": a, "p": ring(g)}))

    # ---------- coastline -> land / sea ----------
    coast = [LineString(pts) for _, (pts, tg, _) in ways.items() if tg.get("natural") == "coastline" and len(pts) > 1]
    frame = clip.buffer(40, join_style=2)
    if coast:
        merged = linemerge(MultiLineString(coast))
        lines = list(getattr(merged, "geoms", [merged]))
        noded = unary_union([frame.exterior] + [l.intersection(frame) for l in lines])
        land, sea = [], []
        segs = []
        for l in lines:
            c = list(l.coords)
            segs += [(c[i], c[i + 1]) for i in range(len(c) - 1)]
        for face in polygonize(noded):
            pt = face.representative_point()
            # nearest coastline segment decides the side: land is on the left of the way direction
            best, side = 1e18, 0
            for (ax, az), (bx, bz) in segs:
                dx, dz = bx - ax, bz - az
                L = dx * dx + dz * dz or 1e-9
                t = max(0, min(1, ((pt.x - ax) * dx + (pt.y - az) * dz) / L))
                d = (ax + t * dx - pt.x) ** 2 + (az + t * dz - pt.y) ** 2
                if d < best:
                    best = d
                    # Three z = -north, so the OSM "left" becomes the right in x/z: flip sign
                    side = dx * (pt.y - az) - dz * (pt.x - ax)
            (land if side < 0 else sea).append(face)
        emit_polys(unary_union(land) if land else None, lambda g: out["land"].append({"p": ring(g), "holes": [[[r1(x), r1(z)] for x, z in list(i.coords)[:-1]] for i in g.interiors]}))
        emit_polys(unary_union(sea) if sea else None, lambda g: out["water"].append(ring(g)))
    else:
        out["land"].append({"p": ring(frame), "holes": []})

    # ---------- point features ----------
    for nid, tg in node_tags.items():
        x, z = nodes[nid]
        if not clip.contains(Point(x, z)):
            continue
        if tg.get("natural") == "tree":
            out["trees"].append([r1(x), r1(z)])
        elif tg.get("amenity") == "bench":
            out["benches"].append([r1(x), r1(z)])
        elif tg.get("highway") == "street_lamp":
            out["lamps"].append([r1(x), r1(z)])
        elif tg.get("highway") == "traffic_signals":
            out["signals"].append([r1(x), r1(z)])
        if tg.get("name") and (tg.get("tourism") or tg.get("historic") or tg.get("amenity") in ("theatre", "townhall", "arts_centre")):
            out["labels"].append({"x": r1(x), "z": r1(z), "n": tg["name"]})
    for b in out["buildings"]:
        if b.get("name") and len(b["p"]) > 2:
            cx = sum(p[0] for p in b["p"]) / len(b["p"])
            cz = sum(p[1] for p in b["p"]) / len(b["p"])
            out["labels"].append({"x": r1(cx), "z": r1(cz), "n": b["name"]})
    out["stats"] = stats
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
