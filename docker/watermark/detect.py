"""Locate retailer watermark overlays and turn them into an inpainting mask.

Detection is template matching, never a guess: each retailer's overlay is
cropped once from a real product photograph and stored under templates/.
A template that does not clear every threshold produces no mask, and an image
with no mask is returned unchanged rather than repainted on spec. That matters
because the shops differ: QV Badminton, HVShop and FBShop stamp nearly every
photograph, while most VNB photographs carry no overlay at all, so a loose
detector would repaint clean product shots.

Matching runs in two stages. Correlation over the whole template window
nominates candidates cheaply; each candidate is then verified over the
template's ink pixels alone. A flat patch of background correlates well with a
mostly-white template window and badly with its ink, which is what separates a
real overlay from a plausible-looking stretch of studio backdrop.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np

TEMPLATE_ROOT = Path(__file__).parent / "templates"
# Widths of the product photographs the templates were cropped from. A shop
# scales its overlay with the canvas, so the search starts at this ratio.
# A "<site>/<template>" key overrides its site's default, for a template taken
# from a differently sized photograph.
REFERENCE_WIDTH = {
    "vnb": 1500,
    "fbshop": 510,
    "qvbadminton": 700,
    # HVShop uses several different overlays rather than one at several sizes:
    # a small corner stamp, a large "HVshop" with a shuttle and sweeping arcs,
    # and a small wordmark with a droplet. They are laid out differently enough
    # that none matches another (ink correlation 0.10 between the first two).
    "hvshop": 534,
    # The large overlay was estimated from 39 photographs of one canvas size:
    # band-passed gradients select the ones carrying it (the overlay's edges
    # are faint, so strong product edges are zeroed rather than clipped, which
    # stops the stack locking onto the racket instead), then a high percentile
    # of their intensities drops the product and leaves the overlay. No single
    # photograph carries it clear of the racket, so no crop of one would do.
    "hvshop/hvshop-large": 800,
}


def reference_width(site: str, name: str) -> int:
    return REFERENCE_WIDTH.get(f"{site}/{name}", REFERENCE_WIDTH[site])


DEFAULT_MIN_SCORE = 0.45
# Correlation over ink pixels only. This is the threshold that rejects a
# well-correlating patch of empty backdrop.
DEFAULT_MIN_INK = 0.40
# Grey levels between the overlay's ink and the background it sits on. An
# overlay too faint to clear this is also too faint to be worth repainting.
DEFAULT_MIN_CONTRAST = 3.0
# A match narrower than this is not a shop's overlay: downscaling destroys the
# ink structure verification relies on, so a shrunken logo correlates happily
# with a dark grip on a white backdrop.
DEFAULT_MIN_WIDTH = 64
MIN_MATCH_SCALE = 0.55
# Ink pixels of a template: whatever differs from its own background.
SHAPE_THRESHOLD = 8
DILATION = 5


@dataclass(frozen=True)
class Settings:
    min_score: float = DEFAULT_MIN_SCORE
    min_ink: float = DEFAULT_MIN_INK
    min_contrast: float = DEFAULT_MIN_CONTRAST
    min_width: int = DEFAULT_MIN_WIDTH
    # How far a template pixel must sit from the template's own background to
    # count as ink, and how far the resulting mask is grown before repainting.
    shape_threshold: int = SHAPE_THRESHOLD
    dilation: int = DILATION
    # What the correlation runs on. "intensity" compares grey levels, which
    # suits a solid overlay. "edges" compares band-passed gradients instead,
    # for an overlay so pale and so large that its window is dominated by the
    # product rather than by the mark: on HVShop's large overlay, intensity
    # correlation found nothing while band-passed gradients separated the
    # photographs carrying it (0.76-0.99) from those without (0.05 and below).
    domain: str = "intensity"


# One global threshold cannot separate these four shops, because they do not
# behave alike. Every number below is the measured span of real overlays in
# scripts/scraper/images/watermark-samples.json, with the margin stated.
SITE_SETTINGS: dict[str, Settings] = {
    # VNB stamps only its 1500 px masters, so a real logo never matched below
    # 110 px wide (110-204 px, ink 0.63-1.00). Every false match on an
    # unstamped VNB photograph came in at 72 px or less, so the width floor is
    # what separates them; ink does not (false matches reached 0.46).
    "vnb": Settings(min_ink=0.55, min_width=96),
    # Stamped on every photograph, top left, at 123-184 px. Ink runs as low as
    # 0.38 where the mark is clipped by the top edge of the canvas.
    "qvbadminton": Settings(min_ink=0.30, min_width=96),
    # Two overlays, and the smallest real match in the whole set: the orange
    # logo at 72-185 px and the "Fbshop.vn" wordmark at 90-118 px, ink 0.47 up.
    # Its logo is the one whose scale the search estimates least precisely, and
    # at the usual growth a faint outline of it survived on a photograph where
    # the interior had been repainted, so the mask is grown further. Both of
    # its overlays sit on plain backdrop, which is what makes that safe.
    "fbshop": Settings(min_ink=0.40, min_width=64, dilation=9),
    # One overlay, always 244 px on a 534 px canvas, but pale: contrast sits at
    # 13-15 grey levels where the other shops clear 80. At the usual ink
    # threshold only the core of the mark is repainted and its outer arcs stay
    # as a visible ghost, so this one is cut finer and grown further.
    "hvshop": Settings(min_ink=0.40, min_width=96, shape_threshold=3, dilation=9),
    # A "<site>/<template>" key overrides its site's settings for that one
    # template. HVShop's large overlay is matched on edges rather than grey
    # levels, so its thresholds are on a different scale from the others'.
    "hvshop/hvshop-large": Settings(
        min_score=0.35, min_ink=0.35, min_contrast=0.0, min_width=200,
        shape_threshold=3, dilation=9, domain="edges",
    ),
}


# Candidate peaks examined per template per scale.
PEAKS_PER_SCALE = 3
# A shop may stamp the same artwork more than once on one photograph, so a
# template may report matches at this many distinct places. Each still clears
# its site's thresholds on its own.
MAX_STAMPS_PER_TEMPLATE = 3
# One stamp matches at several neighbouring scales; this many of them are
# repainted so the mask covers the whole mark rather than one estimate of it.
MAX_MATCHES_PER_STAMP = 6
# How close to its group's best a runner-up must rank to be repainted as well.
NEAR_BEST = 0.85
# Thresholds for the check that runs *after* repainting. They are deliberately
# looser than detection: the question is no longer "is there an overlay here"
# but "is any of it still there", and a faint surviving outline scores well
# below the bar that nominated the overlay in the first place.
RESIDUAL_LIMITS = {"min_score": 0.32, "min_ink": 0.30, "min_contrast": 1.5}


def rank(match: "Detection") -> float:
    """A match is only as good as its weaker measure.

    Ranking on ink alone once picked an empty corner (score 0.48, ink 0.62)
    over the real FBShop logo (score 0.63, ink 0.61) and left the logo on the
    photograph. Neither measure is sufficient by itself: correlation over the
    whole window rewards a flat patch, and ink correlation alone ignores how
    well the match sat in its surroundings.
    """
    return min(match.score, match.ink)


def settings_for(site: str | None, name: str | None = None) -> Settings:
    if name and f"{site}/{name}" in SITE_SETTINGS:
        return SITE_SETTINGS[f"{site}/{name}"]
    return SITE_SETTINGS.get(site or "", Settings())


def bandpass(gray: np.ndarray) -> np.ndarray:
    """Faint edges only: what a pale overlay leaves and a product does not.

    A racket's outline saturates any clip, so strong gradients are zeroed
    rather than clipped; otherwise a stack or a correlation locks onto the
    product, which is what happened before this existed.
    """
    image = gray.astype(np.float32)
    magnitude = cv2.magnitude(
        cv2.Sobel(image, cv2.CV_32F, 1, 0, ksize=3),
        cv2.Sobel(image, cv2.CV_32F, 0, 1, ksize=3),
    )
    faint = np.where((magnitude > 2.5) & (magnitude < 26.0), magnitude, 0.0)
    return cv2.GaussianBlur(faint, (0, 0), 1.2)


@dataclass(frozen=True)
class Template:
    site: str
    name: str
    gray: np.ndarray
    shape: np.ndarray
    reference_width: int
    # What correlation runs on: grey levels, or band-passed gradients.
    features: np.ndarray | None = None
    domain: str = "intensity"

    @property
    def id(self) -> str:
        return f"{self.site}/{self.name}"


@dataclass
class Detection:
    site: str
    template: str
    score: float
    ink: float
    contrast: float
    x: int
    y: int
    width: int
    height: int


def _shape_mask(gray: np.ndarray, threshold: int = SHAPE_THRESHOLD) -> np.ndarray:
    border = np.concatenate([gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]])
    background = float(np.median(border))
    return (np.abs(gray.astype(np.int16) - background) > threshold).astype(np.uint8)


def load_templates(root: Path = TEMPLATE_ROOT) -> list[Template]:
    templates: list[Template] = []
    for path in sorted(root.glob("*/*.png")):
        site = path.parent.name
        if site not in REFERENCE_WIDTH:
            raise ValueError(f"Template {path} has no reference width; add {site} to REFERENCE_WIDTH")
        image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is None or image.size == 0:
            raise ValueError(f"Unreadable template: {path}")
        limits = settings_for(site, path.stem)
        shape = _shape_mask(image, limits.shape_threshold)
        if int(shape.sum()) < 64:
            raise ValueError(f"Template has almost no ink and would match anything: {path}")
        # What correlation sees. For an "edges" template that is its faint
        # gradients; for the rest it is the grey levels themselves.
        features = bandpass(image) if limits.domain == "edges" else image.astype(np.float32)
        templates.append(Template(
            site, path.stem, image, shape, reference_width(site, path.stem), features, limits.domain,
        ))
    if not templates:
        raise ValueError(f"No templates under {root}")
    return templates


def _scales(image_width: int, template: Template) -> list[float]:
    """Two hypotheses: the overlay scales with the canvas, or it is fixed-size.

    The range reaches 2.2 because HVShop stamps the same artwork small in a
    corner on some photographs and large across the middle on others.
    """
    relative = image_width / template.reference_width
    candidates = {round(float(scale), 3) for scale in np.geomspace(0.55, 2.2, 17) * relative}
    candidates.add(1.0)
    return sorted(candidates)


def _peaks(scores: np.ndarray, count: int, window: int) -> list[tuple[float, int, int]]:
    """Top non-adjacent correlation peaks, so one strong decoy cannot hide a real match."""
    working = scores.copy()
    found: list[tuple[float, int, int]] = []
    for _ in range(count):
        _, value, _, location = cv2.minMaxLoc(working)
        if not np.isfinite(value):
            break
        found.append((float(value), int(location[0]), int(location[1])))
        x0, y0 = max(0, location[0] - window), max(0, location[1] - window)
        working[y0 : location[1] + window, x0 : location[0] + window] = -1.0
    return found


def _verify(
    field: np.ndarray, gray: np.ndarray, template: Template, x: int, y: int, width: int, height: int
) -> tuple[float, float]:
    """Correlation over ink pixels, and how far that ink stands off its background.

    `field` is whatever this template matches on — grey levels, or the image's
    band-passed gradients. Contrast is always measured on grey levels, because
    it answers "is this mark visible", which is a question about the picture
    rather than about the matching domain.
    """
    patch = field[y : y + height, x : x + width].astype(np.float32)
    if patch.shape != (height, width):
        return 0.0, 0.0
    shape = cv2.resize(template.shape, (width, height), interpolation=cv2.INTER_NEAREST).astype(bool)
    source = template.features if template.features is not None else template.gray
    needle = cv2.resize(source, (width, height), interpolation=cv2.INTER_AREA).astype(np.float32)
    if int(shape.sum()) < 24 or int((~shape).sum()) < 24:
        return 0.0, 0.0
    ink_actual, ink_expected = patch[shape], needle[shape]
    if ink_actual.std() < 0.5 or ink_expected.std() < 0.5:
        return 0.0, 0.0
    ink = float(np.corrcoef(ink_actual, ink_expected)[0, 1])
    grey = gray[y : y + height, x : x + width].astype(np.float32)
    contrast = abs(float(grey[shape].mean() - grey[~shape].mean()))
    return (ink if np.isfinite(ink) else 0.0), contrast


def _overlaps(a: Detection, b: Detection) -> bool:
    return not (
        a.x + a.width <= b.x or b.x + b.width <= a.x or a.y + a.height <= b.y or b.y + b.height <= a.y
    )


def detect(
    image: np.ndarray,
    templates: list[Template],
    site: str | None = None,
    overrides: dict[str, float] | None = None,
) -> list[Detection]:
    """Best verified, non-overlapping match per template, across scales.

    Thresholds come from the matched template's own site, not from the
    requested one, so a cross-site sweep still judges each overlay by the
    numbers measured for it.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    height, width = gray.shape[:2]
    # Computed once and shared by every template that matches on edges.
    fields: dict[str, np.ndarray] = {"intensity": gray.astype(np.float32)}
    found: list[Detection] = []
    for template in templates:
        if site and template.site != site:
            continue
        limits = settings_for(template.site, template.name)
        if template.domain not in fields:
            fields[template.domain] = bandpass(gray)
        field = fields[template.domain]
        min_score = float((overrides or {}).get("min_score", limits.min_score))
        min_ink = float((overrides or {}).get("min_ink", limits.min_ink))
        min_contrast = float((overrides or {}).get("min_contrast", limits.min_contrast))
        min_width = int((overrides or {}).get("min_width", limits.min_width))
        candidates: list[Detection] = []
        for scale in _scales(width, template):
            match_width = int(round(template.gray.shape[1] * scale))
            match_height = int(round(template.gray.shape[0] * scale))
            if match_width < min_width or match_height < 12 or scale < MIN_MATCH_SCALE:
                continue
            if match_width > width or match_height > height:
                continue
            source = template.features if template.features is not None else template.gray
            needle = cv2.resize(source, (match_width, match_height), interpolation=cv2.INTER_AREA)
            scores = cv2.matchTemplate(field.astype(np.float32), needle.astype(np.float32), cv2.TM_CCOEFF_NORMED)
            for score, x, y in _peaks(scores, PEAKS_PER_SCALE, max(4, match_width // 4)):
                if score < min_score:
                    break  # peaks come back in descending order
                ink, contrast = _verify(field, gray, template, x, y, match_width, match_height)
                if ink < min_ink or contrast < min_contrast:
                    continue
                candidates.append(Detection(template.site, template.id, score, ink, contrast, x, y, match_width, match_height))
        if not candidates:
            continue
        # One overlay matches at several neighbouring scales, and the
        # best-ranked of those is not always the one that covers it: keeping
        # only that one left a ghost outline of the FBShop logo behind. So
        # candidates are first grouped by where they sit, and every close
        # runner-up in a kept group is repainted too, making the mask their
        # union. Painting a pixel twice costs nothing; painting too few leaves
        # the mark on the photograph.
        #
        # Grouping by position is what keeps a cluster of near-identical
        # matches on one spot from crowding out a second, real stamp
        # elsewhere on the same photograph.
        candidates.sort(key=rank, reverse=True)
        groups: list[list[Detection]] = []
        for candidate in candidates:
            for group in groups:
                if _overlaps(candidate, group[0]):
                    group.append(candidate)
                    break
            else:
                groups.append([candidate])
        for group in groups[:MAX_STAMPS_PER_TEMPLATE]:
            cutoff = rank(group[0]) * NEAR_BEST
            found.extend([match for match in group if rank(match) >= cutoff][:MAX_MATCHES_PER_STAMP])
    found.sort(key=rank, reverse=True)
    return found


def build_mask(
    image_shape: tuple[int, int],
    detections: list[Detection],
    templates: list[Template],
    dilation: int | None = None,
) -> np.ndarray:
    """White where the overlay ink is, black everywhere the photograph stays.

    The ink shape is repainted rather than its bounding box: a box around the
    VNB logo would also repaint the shaft the logo sits on.
    """
    height, width = image_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    by_id = {template.id: template for template in templates}
    for match in detections:
        template = by_id[match.template]
        shape = cv2.resize(template.shape, (match.width, match.height), interpolation=cv2.INTER_NEAREST) * 255
        left, top = match.x, match.y
        # Each overlay is grown by its own site's margin before being merged:
        # a pale mark needs more room than a solid one.
        grow = settings_for(template.site, template.name).dilation if dilation is None else dilation
        if grow > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1))
            shape = cv2.dilate(shape, kernel)
        # Dilation reaches past the match window, so paste through a slice
        # clipped to the canvas rather than indexing off the array.
        y0, x0 = max(0, top), max(0, left)
        y1, x1 = min(height, top + shape.shape[0]), min(width, left + shape.shape[1])
        if y1 <= y0 or x1 <= x0:
            continue
        region = mask[y0:y1, x0:x1]
        region[:] = np.maximum(region, shape[y0 - top : y1 - top, x0 - left : x1 - left])
    return mask


def residual(
    cleaned: np.ndarray,
    repainted: list[Detection],
    templates: list[Template],
    site: str | None = None,
) -> list[Detection]:
    """Overlay still matching where one was just repainted.

    Inpainting does not always cover a mark: where the search misjudges an
    overlay's aspect ratio the mask can land offset and leave a faint outline
    behind. Re-running detection on the result at looser thresholds turns that
    from an invisible defect into one the import report names.

    This flags conservatively and is not a verdict. A repainted patch is
    smooth, and a smooth patch correlates with a mostly-blank template about
    as well as a weak overlay did, so a clean result can still match here.
    Over the 33 labelled repaints it named five, one of which was genuinely
    incomplete. Treat a flag as "look at this image", not as "this failed".
    """
    if not repainted:
        return []
    survivors = detect(cleaned, templates, site, dict(RESIDUAL_LIMITS))
    return [match for match in survivors if any(_overlaps(match, before) for before in repainted)]


def report(detections: list[Detection]) -> str:
    return json.dumps([asdict(match) for match in detections], indent=2)
