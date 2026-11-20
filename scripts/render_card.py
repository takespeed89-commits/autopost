"""Instagram・X 用の画像（1080x1350 の JPEG）を作る。

  python3 scripts/render_card.py spec.json

spec.json の例:
{
  "brand": "plugrig",            # plugrig / confa
  "out": "media/20261124-plugrig-bf",   # 出力名（-1.jpg, -2.jpg ... が付く）
  "slides": [
    {"type": "cover", "kicker": "ブラックフライデー前に", "title": "買う前に\\n持ってるか確かめる", "sub": "かぶり買いを防ぐ3つの手順"},
    {"type": "point", "num": "01", "title": "見出し", "body": "本文。改行は \\n"},
    {"type": "list", "title": "見出し", "items": ["項目1", "項目2"]},
    {"type": "end", "title": "PlugRig", "sub": "plugrig.app で無料ではじめる"}
  ]
}
必要: Pillow、cairosvg（pip install cairosvg --break-system-packages）、Noto Sans/Serif CJK
"""
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1080, 1350
NOTO = "/usr/share/fonts/opentype/noto/"

BRANDS = {
    "plugrig": {
        "bg": (17, 19, 24),
        "bg2": (28, 24, 18),
        "ink": (244, 241, 234),
        "soft": (160, 160, 170),
        "accent": (217, 154, 0),
        "accent2": (242, 178, 51),
        "panel": (30, 32, 38),
        "logo": "assets/plugrig-logo-white.svg",
        "logo_w": 300,
        "footer": "plugrig.app",
        "title_font": "NotoSansCJK-Black.ttc",
        "body_font": "NotoSansCJK-Medium.ttc",
    },
    "confa": {
        "bg": (245, 247, 251),
        "bg2": (232, 245, 239),
        "ink": (28, 31, 38),
        "soft": (92, 96, 104),
        "accent": (31, 58, 104),
        "accent2": (63, 119, 196),
        "panel": (255, 255, 255),
        "logo": "assets/confa-logo-mark.svg",
        "logo_w": 76,
        "wordmark": "カンファ",
        "footer": "confa.jp",
        "title_font": "NotoSerifCJK-Bold.ttc",
        "body_font": "NotoSansCJK-Medium.ttc",
    },
}

NO_START = set("、。，．・：；？！ー）」』】〕〉》’”…‥ぁぃぅぇぉっゃゅょァィゥェォッャュョ,.!?)]}%")
NO_END = set("（「『【〔〈《‘“([{")


def font(name, size):
    return ImageFont.truetype(os.path.join(NOTO, name), size, index=0)


def tokens(text):
    """英数字の単語はまとめ、日本語は1文字ずつに分ける"""
    out, buf = [], ""
    for ch in text:
        if ch.isascii() and (ch.isalnum() or ch in "-_./:%&+'"):
            buf += ch
        else:
            if buf:
                out.append(buf)
                buf = ""
            out.append(ch)
    if buf:
        out.append(buf)
    return out


def wrap(draw, text, f, width):
    lines = []
    for para in text.split("\n"):
        line = ""
        for tk in tokens(para):
            if draw.textlength(line + tk, font=f) <= width or not line.strip():
                line += tk
                continue
            # 行頭に来てはいけない文字は前の行にぶら下げる
            if tk[0] in NO_START:
                line += tk
                continue
            if line and line[-1] in NO_END:
                carry = line[-1]
                lines.append(line[:-1].rstrip())
                line = carry + tk
                continue
            lines.append(line.rstrip())
            line = tk.lstrip()
        lines.append(line.rstrip())
    return lines


def line_h(f, spacing):
    return int(f.size * spacing)


def draw_lines(draw, xy, lines, f, fill, spacing):
    x, y = xy
    lh = line_h(f, spacing)
    for ln in lines:
        draw.text((x, y), ln, font=f, fill=fill)
        y += lh
    return y - lh + int(f.size * 1.25)  # 最後の行は字の高さ（下の余白込み）だけ進める


def block_h(f, n, spacing):
    return line_h(f, spacing) * (n - 1) + int(f.size * 1.25) if n else 0


def fit_text(draw, text, font_name, max_size, min_size, width, max_lines, max_h=10**6, spacing=1.4):
    """入る範囲でいちばん大きい字にする。最後の行が1〜2文字だけになる組み方は避ける"""
    # まず、指定した改行どおりに収まる（行の途中で折り返さない）いちばん大きい字を探す
    # （改行の指定がない文は、行の途中で折り返してよいので飛ばす。1行に詰めるために字を小さくしない）
    paras = text.split("\n")
    size = max_size if len(paras) > 1 else min_size - 1
    while size >= min_size:
        f = font(font_name, size)
        if all(draw.textlength(p, font=f) <= width for p in paras) and block_h(f, len(paras), spacing) <= max_h:
            return f, paras
        size -= 2
    fallback = None
    size = max_size
    while size >= min_size:
        f = font(font_name, size)
        lines = wrap(draw, text, f, width)
        ok = len(lines) <= max_lines and block_h(f, len(lines), spacing) <= max_h
        if ok:
            orphan = len(lines) > 1 and len(lines[-1].strip()) <= 2
            if not orphan:
                return f, lines
            fallback = fallback or (f, lines)
        size -= 2
    if fallback:
        return fallback
    f = font(font_name, min_size)
    return f, wrap(draw, text, f, width)


def svg_logo(path, width):
    import cairosvg

    png = cairosvg.svg2png(url=os.path.join(ROOT, path), output_width=width)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def background(b):
    img = Image.new("RGB", (W, H), b["bg"])
    # 下に向かってわずかに色を寄せる
    top, bot = b["bg"], b["bg2"]
    px = img.load()
    for y in range(H):
        t = (y / H) ** 1.6
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    return img


def header(img, draw, brand, b, page=None, total=None):
    M = 80
    logo = svg_logo(b["logo"], b["logo_w"])
    img.paste(logo, (M, M), logo)
    if b.get("wordmark"):
        wf = font("NotoSansCJK-Bold.ttc", 40)
        draw.text((M + logo.width + 18, M + logo.height // 2), b["wordmark"], font=wf, fill=b["ink"], anchor="lm")
    if page and total and total > 1:
        pf = font("NotoSansCJK-Medium.ttc", 30)
        draw.text((W - M, M + logo.height // 2), f"{page} / {total}", font=pf, fill=b["soft"], anchor="rm")
    return M + logo.height


def footer(draw, b, text=None):
    M = 80
    f = font("NotoSansCJK-Medium.ttc", 30)
    draw.line([(M, H - 150), (W - M, H - 150)], fill=b["soft"], width=1)
    draw.text((M, H - 100), text or b["footer"], font=f, fill=b["soft"], anchor="lm")


def accent_bar(draw, b, x, y, w=96, h=10):
    draw.rectangle([x, y, x + w, y + h], fill=b["accent"])


def render_slide(brand, s, page, total):
    b = BRANDS[brand]
    img = background(b)
    draw = ImageDraw.Draw(img)
    M = 80
    width = W - M * 2
    top = header(img, draw, brand, b, page, total) + 120
    t = s.get("type", "cover")
    bottom = H - 190  # 区切り線の少し上まで
    ink2 = b["ink"] if brand == "confa" else (214, 212, 206)

    if t == "cover":
        y = top + 60
        if s.get("kicker"):
            kf = font("NotoSansCJK-Bold.ttc", 40)
            draw.text((M, y), s["kicker"], font=kf, fill=b["accent"])
            y += 84
        tf, lines = fit_text(draw, s["title"], b["title_font"], 108, 64, width, 4, 520, 1.32)
        y = draw_lines(draw, (M, y), lines, tf, b["ink"], 1.32) + 56
        accent_bar(draw, b, M, y)
        y += 64
        if s.get("sub"):
            sf, sl = fit_text(draw, s["sub"], b["body_font"], 46, 32, width, 4, bottom - y, 1.6)
            draw_lines(draw, (M, y), sl, sf, b["soft"], 1.6)

    elif t == "point":
        y = top + 10
        if s.get("num"):
            nf = font("NotoSansCJK-Black.ttc", 120)
            draw.text((M - 4, y - 20), s["num"], font=nf, fill=b["accent"])
            y += 150
        tf, lines = fit_text(draw, s["title"], b["title_font"], 76, 50, width, 3, 300, 1.34)
        y = draw_lines(draw, (M, y), lines, tf, b["ink"], 1.34) + 44
        accent_bar(draw, b, M, y, 64, 8)
        y += 56
        bf, bl = fit_text(draw, s.get("body", ""), b["body_font"], 44, 30, width, 12, bottom - y, 1.75)
        draw_lines(draw, (M, y), bl, bf, ink2, 1.75)

    elif t == "list":
        y = top + 10
        tf, lines = fit_text(draw, s["title"], b["title_font"], 72, 50, width, 3, 280, 1.34)
        y = draw_lines(draw, (M, y), lines, tf, b["ink"], 1.34) + 64
        items = s.get("items", [])
        size = 44
        while size > 30:
            f = font(b["body_font"], size)
            wrapped = [wrap(draw, it, f, width - 50) for it in items]
            total = sum(block_h(f, len(w), 1.55) for w in wrapped) + 44 * (len(items) - 1)
            if total <= bottom - y:
                break
            size -= 2
        for il in wrapped:
            draw.ellipse([M, y + size * 0.42, M + 16, y + size * 0.42 + 16], fill=b["accent"])
            y = draw_lines(draw, (M + 46, y), il, f, ink2, 1.55) + 44

    elif t == "end":
        y = top + 140
        tf, lines = fit_text(draw, s.get("title", ""), b["title_font"], 92, 60, width, 3, 360, 1.3)
        y = draw_lines(draw, (M, y), lines, tf, b["ink"], 1.3) + 56
        accent_bar(draw, b, M, y)
        y += 64
        if s.get("sub"):
            sf, sl = fit_text(draw, s["sub"], b["body_font"], 46, 32, width, 6, bottom - y, 1.6)
            draw_lines(draw, (M, y), sl, sf, b["soft"], 1.6)
    else:
        raise SystemExit(f"不明な type: {t}")

    footer(draw, b, s.get("footer"))
    return img


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    brand = spec["brand"]
    slides = spec["slides"]
    out = spec["out"]
    paths = []
    for i, s in enumerate(slides, 1):
        img = render_slide(brand, s, i, len(slides))
        p = f"{out}-{i}.jpg"
        os.makedirs(os.path.dirname(os.path.join(ROOT, p)), exist_ok=True)
        img.save(os.path.join(ROOT, p), "JPEG", quality=90, optimize=True, progressive=False)
        paths.append(p)
    print(json.dumps(paths, ensure_ascii=False))


if __name__ == "__main__":
    main()
