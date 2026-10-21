"""Build the local scenic heading font from the verified OFL source (no network).

Usage: python tools/build-journey-font.py /path/to/LongCang-Regular.ttf
Requires fonttools[woff]==4.60.1 in a temporary build environment, not production.
Only the binary font in static/assets is generated; the original fonts stay intact.
"""
import argparse
import hashlib
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE_SHA256 = "e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc"
SEED = "一卷黄鹤楼主楼古铜顶白云阁鹅池读这一景出处与核对景物札记收卷留念回到画卷正在取阅"


def input_files():
    return sorted([
        ROOT / "explore-journey.html",
        ROOT / "tools/preview/exploration-trial-suite.html",
        ROOT / "tools/fixtures/four-scenes-study.json",
        ROOT / "tools/fixtures/four-scenes-inquiries.json",
        *ROOT.glob("static/exploration-journey-*.js"),
    ])


def required_characters():
    text = SEED + "".join(file.read_text(encoding="utf-8") for file in input_files())
    return set(re.findall(r"[\u3400-\u9fff]", text))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit("Unexpected upstream font; review the source and license before changing its pinned hash.")
    font = TTFont(args.source, recalcTimestamp=False)
    required = required_characters()
    cmap = font.getBestCmap()
    missing = sorted(character for character in required if ord(character) not in cmap)
    if missing:
        raise SystemExit("Upstream font does not cover: " + "".join(missing))
    options = subset.Options()
    options.flavor = "woff2"
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_legacy = True
    options.name_languages = [0x409]
    options.recalc_timestamp = False
    builder = subset.Subsetter(options=options)
    builder.populate(unicodes={ord(character) for character in required} | set(range(0x20, 0x7f)) | set(range(0x3000, 0x3040)))
    builder.subset(font)
    font.flavor = "woff2"
    output = ROOT / "static/assets/longcang-journey-v1.woff2"
    font.save(output)
    verified = TTFont(output).getBestCmap()
    assert all(ord(character) in verified for character in required)
    print(f"Journey font: {len(required)} required CJK characters; {output.stat().st_size} bytes; SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
