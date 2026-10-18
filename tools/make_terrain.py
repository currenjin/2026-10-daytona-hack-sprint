"""Build web/assets/terrain.png (+ terrain.json) from Copernicus DEM GLO-30 (AWS open data, no key).

Run with a Python that has rasterio, numpy, pillow:
    python tools/make_terrain.py
Height is encoded in R (high byte) and G (low byte) as metres + 0; sea/void = 0.
"""
import json, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.merge import merge
from PIL import Image

BBOX = (128.95, 34.85, 129.45, 35.35)  # lon0, lat0, lon1, lat1 (demo domain + margin)
N = 512
URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM/Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM.tif"
srcs = [rasterio.open(URL.format(lat=la, lon=lo)) for la in (34, 35) for lo in (128, 129)]
arr, tr = merge(srcs, bounds=BBOX, res=((BBOX[2]-BBOX[0])/N, (BBOX[3]-BBOX[1])/N))
h = np.nan_to_num(arr[0].astype("float32"), nan=0.0)
h = np.clip(h, 0, 65535).astype("uint16")[:N, :N]
rgb = np.zeros((h.shape[0], h.shape[1], 3), "uint8")
rgb[..., 0] = h >> 8; rgb[..., 1] = h & 255; rgb[..., 2] = (h > 0) * 255
out = Path(__file__).resolve().parent.parent / "web" / "assets"
Image.fromarray(rgb).save(out / "terrain.png")
json.dump({"bbox_lon_lat": BBOX, "size": list(h.shape), "max_m": int(h.max()),
           "encoding": "height_m = R*256 + G; B=255 where height>0 (land); sea/void height 0",
           "source": "Copernicus DEM GLO-30 via AWS Open Data (copernicus-dem-30m)",
           "attribution": "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
           "note": "Display terrain only. Not a verified coastline for drift stranding."},
          open(out / "terrain.json", "w"), ensure_ascii=False, indent=1)
print(h.shape, h.max(), (h > 0).mean())
