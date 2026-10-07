"""A small moving image, built in pure Python, with nothing installed.

The mock video provider has to hand back **something a member can open**
so the download flow can be exercised before Higgsfield exists. Writing a
file with an `.mp4` name that no player opens would be worse than no
placeholder at all: the download would look finished while being broken.

So the placeholder is an animated GIF, and it is named `.gif`. A GIF is a
real moving image — browsers play it, image viewers play it — and GIF89a
is the one animated format that can be written correctly by hand with no
encoder and no dependency. H.264 cannot: a conforming MP4 needs a codec,
and there is no ffmpeg on the machines this runs on.

Phase 6 replaces this with the asset Higgsfield returns, which will be an
`.mp4`. Nothing else changes, because the provider hands back its own
content type and extension (`VideoAsset`) and the download route uses
what it is given.

## The one subtle part

GIF image data is LZW-compressed, and this writes **uncompressed** LZW —
every pixel as a literal code, no dictionary ever used. That is legal, and
far simpler than a compressor, but it is not free: a decoder adds a
dictionary entry for every code it reads, so *its* code width grows even
though the encoder never uses the new codes. If the encoder does not grow
in step, the stream desynchronises and the image is garbage.

The fix here is to emit a CLEAR code before the width could change. With a
minimum code size of 2 the decoder starts at 3 bits with its next slot at
6, and reaches 8 — where it would widen — after three codes. Emitting
CLEAR every two literals keeps it at 3 bits forever, so the encoder never
has to track the decoder's table at all. It costs about 1.5 codes per
pixel, which for a 64-pixel-wide clip is a few kilobytes: irrelevant for a
placeholder, and worth it to keep this code short enough to be obviously
correct.
"""

from __future__ import annotations

from io import BytesIO

#: Palette, as (r, g, b). Index 0 is the background; the rest draw the
#: moving band. Four colours keeps the minimum code size at 2.
PALETTE: tuple[tuple[int, int, int], ...] = (
    (10, 10, 11),  # --bg, the same near-black the product uses
    (1, 83, 204),  # --accent-strong
    (154, 194, 254),  # --accent
    (242, 242, 242),  # --text
)

#: Minimum LZW code size. 2 is the smallest GIF allows and fits 4 colours.
MIN_CODE_SIZE = 2
CLEAR_CODE = 1 << MIN_CODE_SIZE  # 4
END_CODE = CLEAR_CODE + 1  # 5
CODE_WIDTH = MIN_CODE_SIZE + 1  # 3 bits, held constant — see the docstring

#: How many literals may follow a CLEAR before the decoder would widen.
LITERALS_PER_CLEAR = 2


class _BitWriter:
    """Packs codes least-significant-bit first, as GIF requires."""

    def __init__(self) -> None:
        self._bytes = bytearray()
        self._current = 0
        self._bits = 0

    def write(self, code: int, width: int) -> None:
        self._current |= code << self._bits
        self._bits += width
        while self._bits >= 8:
            self._bytes.append(self._current & 0xFF)
            self._current >>= 8
            self._bits -= 8

    def finish(self) -> bytes:
        if self._bits:
            self._bytes.append(self._current & 0xFF)
            self._current = 0
            self._bits = 0
        return bytes(self._bytes)


def _sub_blocks(payload: bytes) -> bytes:
    """GIF data is carried in length-prefixed blocks of at most 255 bytes."""
    out = bytearray()
    for start in range(0, len(payload), 255):
        chunk = payload[start : start + 255]
        out.append(len(chunk))
        out.extend(chunk)
    out.append(0)  # block terminator
    return bytes(out)


def _lzw_uncompressed(indices: bytes) -> bytes:
    """Every pixel as a literal, with a CLEAR often enough to hold the width."""
    writer = _BitWriter()
    writer.write(CLEAR_CODE, CODE_WIDTH)

    for position, index in enumerate(indices):
        if position and position % LITERALS_PER_CLEAR == 0:
            writer.write(CLEAR_CODE, CODE_WIDTH)
        writer.write(index, CODE_WIDTH)

    writer.write(END_CODE, CODE_WIDTH)
    return _sub_blocks(writer.finish())


def _frame_pixels(width: int, height: int, step: int, steps: int) -> bytes:
    """One frame: a soft vertical band sweeping left to right.

    Deliberately plain. The placeholder's job is to be openable and
    obviously a placeholder, not to look like a generated video.
    """
    centre = int((step + 0.5) / steps * width)
    band = max(2, width // 8)

    rows = bytearray()
    for y in range(height):
        for x in range(width):
            distance = abs(x - centre)
            if distance <= band // 3:
                rows.append(3)
            elif distance <= band // 2:
                rows.append(2)
            elif distance <= band:
                rows.append(1)
            else:
                rows.append(0)
        # A thin baseline so a still first frame does not look blank.
        if y == height - 1:
            rows[-width:] = bytes([1] * width)
    return bytes(rows)


def build(width: int = 64, height: int = 64, frames: int = 8, delay_cs: int = 12) -> bytes:
    """Return a looping animated GIF.

    `delay_cs` is centiseconds per frame, which is GIF's own unit. The
    defaults make a 64×64 clip of about a second — enough to see it move,
    small enough that it costs nothing to store.
    """
    out = BytesIO()
    out.write(b"GIF89a")

    # Logical screen descriptor. Packed byte: global colour table present,
    # size field 1 meaning 2^(1+1) = 4 entries.
    out.write(width.to_bytes(2, "little"))
    out.write(height.to_bytes(2, "little"))
    out.write(bytes([0x80 | 0x01, 0x00, 0x00]))

    for red, green, blue in PALETTE:
        out.write(bytes([red, green, blue]))

    # NETSCAPE2.0 application extension: loop forever.
    out.write(b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00")

    for step in range(frames):
        # Graphic control extension: disposal 1 (leave in place), no
        # transparency, `delay_cs` before the next frame.
        out.write(b"\x21\xf9\x04\x04")
        out.write(delay_cs.to_bytes(2, "little"))
        out.write(b"\x00\x00")

        # Image descriptor: full frame, no local colour table.
        out.write(b"\x2c\x00\x00\x00\x00")
        out.write(width.to_bytes(2, "little"))
        out.write(height.to_bytes(2, "little"))
        out.write(b"\x00")

        out.write(bytes([MIN_CODE_SIZE]))
        out.write(_lzw_uncompressed(_frame_pixels(width, height, step, frames)))

    out.write(b"\x3b")  # trailer
    return out.getvalue()
