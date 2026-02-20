#!/usr/bin/env python3
"""
LoveSpark Popup Blocker — generate_icons.py
Generates pink shield icons at 16, 48, and 128px using Pillow.

Install dependency:
    pip install Pillow
    # or: pip3 install Pillow

Run:
    python3 generate_icons.py
"""

import os
import math
from PIL import Image, ImageDraw, ImageFont

# ── Color palette ──────────────────────────────────────────────────────────
HOT_PINK      = (255, 105, 180, 255)   # #FF69B4  — shield fill
LIGHT_PINK    = (255, 182, 193, 255)   # #FFB6C1  — shield border / glow
DARK_BG       = (26, 10, 16, 0)        # transparent background
WHITE         = (255, 255, 255, 255)
SHADOW_PINK   = (200, 50, 120, 160)    # subtle inner shadow


def shield_points(cx, cy, w, h):
    """
    Build a shield polygon. The shield has:
      - a flat top with rounded shoulders
      - straight sides
      - a pointed bottom
    Returns a list of (x, y) tuples suitable for ImageDraw.polygon().
    """
    # Proportions (as fractions of w/h)
    top_y   = cy - h * 0.46   # top edge
    mid_y   = cy - h * 0.05   # widest point
    tip_y   = cy + h * 0.50   # bottom point
    side_x  = w * 0.48        # half-width at widest

    # Control points — approximate a shield with 8 vertices
    pts = [
        (cx - side_x * 0.70, top_y),           # top-left notch
        (cx - side_x,        top_y + h * 0.12),# left shoulder
        (cx - side_x,        mid_y),            # left side
        (cx,                 tip_y),            # bottom point
        (cx + side_x,        mid_y),            # right side
        (cx + side_x,        top_y + h * 0.12),# right shoulder
        (cx + side_x * 0.70, top_y),           # top-right notch
        (cx,                 top_y + h * 0.04),# top center (slight dip)
    ]
    return pts


def draw_x(draw, cx, cy, size, color, width):
    """Draw a clean × symbol centred at (cx, cy)."""
    half = size / 2
    # Diagonal / (bottom-left to top-right)
    draw.line(
        [(cx - half, cy + half * 0.8), (cx + half, cy - half * 0.8)],
        fill=color, width=width
    )
    # Diagonal \ (top-left to bottom-right)
    draw.line(
        [(cx - half, cy - half * 0.8), (cx + half, cy + half * 0.8)],
        fill=color, width=width
    )


def generate_icon(size):
    """Create a single RGBA icon image at the given pixel size."""
    img  = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = size / 2, size / 2

    # Shield dimensions — leave a small margin
    margin = size * 0.06
    sw = size - margin * 2   # shield width
    sh = size - margin * 2   # shield height

    pts = shield_points(cx, cy, sw, sh)

    # ── Drop shadow (offset slightly, semi-transparent) ────────────────────
    shadow_offset = max(1, size // 20)
    shadow_pts = [(x + shadow_offset, y + shadow_offset) for x, y in pts]
    draw.polygon(shadow_pts, fill=(80, 0, 40, 90))

    # ── Main shield fill ───────────────────────────────────────────────────
    draw.polygon(pts, fill=HOT_PINK)

    # ── Border ────────────────────────────────────────────────────────────
    border_width = max(1, size // 24)
    draw.polygon(pts, outline=LIGHT_PINK, width=border_width)

    # ── Inner highlight (top edge gloss) ─────────────────────────────────
    # A small lighter ellipse at the top-centre gives a glossy feel
    if size >= 48:
        gx, gy   = cx, cy - sh * 0.25
        gr, gh   = sw * 0.30, sh * 0.12
        draw.ellipse(
            [(gx - gr, gy - gh), (gx + gr, gy + gh)],
            fill=(255, 200, 220, 60)
        )

    # ── × symbol ──────────────────────────────────────────────────────────
    x_size  = sw * 0.30
    x_width = max(1, size // 18)
    x_cy    = cy + sh * 0.02   # slightly below center to look balanced in shield

    if size <= 16:
        # At tiny sizes, just a thicker dot or minimal mark
        dot_r = size * 0.10
        draw.ellipse(
            [(cx - dot_r, x_cy - dot_r), (cx + dot_r, x_cy + dot_r)],
            fill=WHITE
        )
    else:
        draw_x(draw, cx, x_cy, x_size, WHITE, x_width)

    return img


def main():
    out_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(out_dir, exist_ok=True)

    sizes = [16, 48, 128]
    for size in sizes:
        img  = generate_icon(size)
        path = os.path.join(out_dir, f'icon-{size}.png')
        img.save(path, 'PNG', optimize=True)
        print(f'  Generated {path}  ({size}x{size})')

    print('\nDone! Icons saved to icons/')


if __name__ == '__main__':
    main()
