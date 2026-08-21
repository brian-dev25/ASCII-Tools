"""Bundled img2braille variant with optional output height and mobile rendering support."""
import argparse
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument("input")
parser.add_argument("-w", "--width", type=int, default=200)
parser.add_argument("-H", "--height", type=int, default=0,
                    help="output height in Braille rows; 0 keeps aspect ratio")
parser.add_argument("-m", "--mobile", action="store_true",
                    help="adjust aspect ratio for mobile screens / fonts")
parser.add_argument("-i", "--noinvert", dest="invert", action="store_false", default=True)
parser.add_argument("-d", "--dither", action="store_true")
parser.add_argument("-a", "--autocontrast", action="store_true")
parser.add_argument("-n", "--noempty", action="store_true")
parser.add_argument("--calc", choices=["RGBsum", "R", "G", "B", "BW"], default="RGBsum")
args = parser.parse_args()

image = Image.open(args.input).convert("RGB")

pixel_width = max(2, args.width * 2)

if args.height > 0:
    pixel_height = args.height * 4
else:
    # Si la opción móvil está activada, se aplica un factor de escala (~1.8)
    # para compensar la forma cuadrada de los caracteres Braille en fuentes móviles.
    aspect_factor = 1.8 if args.mobile else 1.0
    pixel_height = round((pixel_width * image.height / image.width) * aspect_factor)

pixel_height = max(4, pixel_height + ((4 - pixel_height % 4) % 4))
image = image.resize((pixel_width, pixel_height), Image.Resampling.LANCZOS)

if args.calc == "BW":
    image = image.convert("L").convert("RGB")
elif args.calc in {"R", "G", "B"}:
    channel = {"R": 0, "G": 1, "B": 2}[args.calc]
    image = Image.merge("RGB", [image.getchannel(channel)] * 3)

if args.autocontrast:
    image = ImageOps.autocontrast(image)
if args.dither:
    image = image.convert("1", dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")

pixels = image.load()
average = sum(sum(pixels[x, y]) for y in range(image.height) for x in range(image.width)) / (image.width * image.height)
dot_bits = ((0, 0, 0x01), (1, 0, 0x08), (0, 1, 0x02), (1, 1, 0x10),
            (0, 2, 0x04), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80))

for y in range(0, image.height, 4):
    line = []
    for x in range(0, image.width, 2):
        value = 0
        for dx, dy, bit in dot_bits:
            dark = sum(pixels[x + dx, y + dy]) < average
            if dark == args.invert:
                value |= bit
        if args.noempty and value == 0:
            value = 1
        line.append(chr(0x2800 + value))
    print("".join(line))