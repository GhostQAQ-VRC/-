"""Generate a multi-size Windows .ico from build/icon.png (requires Pillow)."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.png"
TARGET = ROOT / "build" / "icon.ico"
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing {SOURCE}; run `node desktop/make-icon.cjs` first")
    image = Image.open(SOURCE).convert("RGBA")
    image.save(TARGET, format="ICO", sizes=SIZES)
    print(f"[desktop:icon] build/icon.ico ({len(SIZES)} sizes)")


if __name__ == "__main__":
    main()
