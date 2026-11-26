"""Prepare the three CC0 field recordings; requires ffmpeg/ffprobe.

Usage: python tools/prepare_ambience.py <folder with rain.mp3, wind.mp3, night.mp3>
Source URLs, edits and licenses are recorded in app/public/audio/ambience/sources.json.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "app/public/audio/ambience"
SOURCES = [
    ("rain", "joedeshon", 430765, "long_easy_rain_08", 8, 72, -20),
    ("wind", "keweldog", 181801, "breeze", 3, 56, -20),
    ("night", "hopperphil", 685411, "Crickets", 8, 72, -24),
]


def prepare(folder: Path):
    DEST.mkdir(parents=True, exist_ok=True)
    records = []
    for name, author, sound_id, title, start, length, level in SOURCES:
        original = folder / f"{name}.mp3"
        # Bounded HQ preview excerpts are also valid input (long files can be large).
        excerpt = folder / f"{name}-excerpt.mp3"
        if excerpt.exists():
            original = excerpt
        boundary = 4
        loop = (
            f"[0:a]atrim=start={start}:duration={length},asetpts=PTS-STARTPTS,"
            "highpass=f=70,lowpass=f=7500,asplit=3[h][m][t];"
            f"[h]atrim=0:{boundary},asetpts=PTS-STARTPTS[head];"
            f"[m]atrim={boundary}:{length-boundary},asetpts=PTS-STARTPTS[mid];"
            f"[t]atrim=start={length-boundary},asetpts=PTS-STARTPTS[tail];"
            f"[tail][head]acrossfade=d={boundary}:c1=tri:c2=tri[seam];"
            "[mid][seam]concat=n=2:v=0:a=1[loop];"
        )
        norm = f"loudnorm=I={level}:TP=-4:LRA=11"
        measured = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", str(original), "-filter_complex",
             loop + f"[loop]{norm}:print_format=json[out]", "-map", "[out]", "-f", "null", "-"],
            capture_output=True, text=True, check=True,
        )
        stats = json.loads(re.findall(r"\{[^{}]+\}", measured.stderr)[-1])
        linear = norm + ":linear=true:" + ":".join([
            f"measured_I={stats['input_i']}", f"measured_TP={stats['input_tp']}",
            f"measured_LRA={stats['input_lra']}", f"measured_thresh={stats['input_thresh']}",
            f"offset={stats['target_offset']}",
        ])
        output = DEST / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(original), "-filter_complex",
             loop + f"[loop]{linear}[out]", "-map", "[out]", "-ar", "44100", "-ac", "2",
             "-codec:a", "libmp3lame", "-b:a", "160k", "-map_metadata", "-1", str(output)], check=True,
        )
        records.append(dict(name=name, title=title, author=author,
                            source=f"https://freesound.org/people/{author}/sounds/{sound_id}/",
                            license="CC0-1.0", start_s=start, source_length_s=length,
                            crossfade_s=boundary, loudness_lufs=level,
                            sha256=hashlib.sha256(output.read_bytes()).hexdigest()))
        print(f"{name}: {length-boundary}s, {output.stat().st_size} bytes", flush=True)
    (DEST / "sources.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
