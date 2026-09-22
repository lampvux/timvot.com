"""Tests for the detector, run inside the image:

    docker compose run --rm --no-deps watermark python -m unittest -v test_detect

Fixtures are synthesised from the committed templates rather than from real
product photographs, so the suite needs no network and no third-party images.
A synthetic paste is an easier target than a real overlay, so these tests fix
the mechanics — placement, scaling, masking, per-site settings, refusal on a
clean canvas — not the thresholds. The thresholds are set from the labelled
photographs recorded in docs/retailer-image-backfill.md.
"""
from __future__ import annotations

import unittest

import cv2
import numpy as np

from detect import (
    SITE_SETTINGS,
    bandpass,
    Template,
    build_mask,
    detect,
    load_templates,
    residual,
    settings_for,
)

TEMPLATES = load_templates()
BY_ID = {template.id: template for template in TEMPLATES}


def canvas(width: int, height: int, value: int = 245) -> np.ndarray:
    """A studio backdrop with faint noise, so nothing is perfectly flat."""
    rng = np.random.default_rng(7)
    base = np.full((height, width, 3), value, dtype=np.uint8)
    return np.clip(base.astype(np.int16) + rng.integers(-2, 3, base.shape), 0, 255).astype(np.uint8)


def with_racket(image: np.ndarray) -> np.ndarray:
    """A dark shaft and grip: the shapes that used to draw false matches."""
    height, width = image.shape[:2]
    cv2.line(image, (width // 2, height // 3), (width // 2, height - 40), (30, 30, 30), 7)
    cv2.rectangle(image, (width // 2 - 9, height - 120), (width // 2 + 9, height - 40), (15, 15, 15), -1)
    cv2.ellipse(image, (width // 2, height // 4), (width // 6, height // 8), 0, 0, 360, (40, 40, 40), 4)
    return image


def paste(image: np.ndarray, template: Template, x: int, y: int, scale: float = 1.0, alpha: float = 1.0) -> np.ndarray:
    """Alpha-blend a template's ink onto the canvas, the way a shop stamps one."""
    width = int(round(template.gray.shape[1] * scale))
    height = int(round(template.gray.shape[0] * scale))
    ink = cv2.resize(template.gray, (width, height), interpolation=cv2.INTER_AREA)
    shape = cv2.resize(template.shape, (width, height), interpolation=cv2.INTER_NEAREST).astype(bool)
    region = image[y : y + height, x : x + width]
    overlay = cv2.cvtColor(ink, cv2.COLOR_GRAY2BGR)
    blended = (region.astype(np.float32) * (1 - alpha) + overlay.astype(np.float32) * alpha)
    region[shape] = blended[shape].astype(np.uint8)
    return image


def stamps(found: list) -> list:
    """Distinct overlays among the matches.

    One stamp is reported as several overlapping matches on purpose, so that
    the repainted mask is their union rather than one estimate of the mark.
    Tests about 'how many overlays are on this photograph' count groups.
    """
    groups: list = []
    for match in found:
        for group in groups:
            first = group[0]
            if not (
                match.x + match.width <= first.x or first.x + first.width <= match.x
                or match.y + match.height <= first.y or first.y + first.height <= match.y
            ):
                group.append(match)
                break
        else:
            groups.append([match])
    return groups


class TemplateLoading(unittest.TestCase):
    def test_every_template_has_a_site_with_settings(self):
        self.assertTrue(TEMPLATES)
        for template in TEMPLATES:
            self.assertIn(template.site, SITE_SETTINGS, template.id)
            self.assertGreater(int(template.shape.sum()), 64, template.id)

    def test_a_template_is_cut_at_its_own_sites_threshold(self):
        # HVShop's overlay is pale, so it is cut finer than the others; that
        # setting has to reach template loading, not just mask building.
        self.assertEqual(settings_for("hvshop").shape_threshold, 3)
        hv = next(template for template in TEMPLATES if template.site == "hvshop")
        qv = next(template for template in TEMPLATES if template.site == "qvbadminton")
        self.assertGreater(hv.shape.mean(), 0.0)
        self.assertGreater(qv.shape.mean(), 0.0)


class Detection(unittest.TestCase):
    def test_a_pasted_overlay_is_found_where_it_was_pasted(self):
        for template in TEMPLATES:
            with self.subTest(template.id):
                # Sized from the template: HVShop's large overlay is 675 px
                # wide and would not fit a fixed canvas.
                height, width = template.gray.shape[:2]
                image = paste(canvas(width + 600, height + 600), template, 300, 260)
                found = detect(image, TEMPLATES, template.site)
                self.assertEqual({match.template for match in found}, {template.id})
                self.assertEqual(len(stamps(found)), 1)
                self.assertAlmostEqual(found[0].x, 300, delta=8)
                self.assertAlmostEqual(found[0].y, 260, delta=8)

    def test_a_scaled_overlay_is_found_at_its_scale(self):
        template = BY_ID["qvbadminton/quoc-viet"]
        image = paste(canvas(1000, 1000), template, 120, 90, scale=1.4)
        found = detect(image, TEMPLATES, "qvbadminton")
        self.assertEqual(len(stamps(found)), 1)
        self.assertAlmostEqual(found[0].width / template.gray.shape[1], 1.4, delta=0.2)

    def test_a_half_transparent_overlay_is_still_found(self):
        # VNB's logo is alpha-blended, which costs contrast but not structure,
        # and the correlation score is chosen to ignore exactly that.
        template = BY_ID["vnb/vnb-logo"]
        image = paste(with_racket(canvas(1500, 1500)), template, 950, 600, alpha=0.5)
        found = detect(image, TEMPLATES, "vnb")
        self.assertEqual(len(stamps(found)), 1)
        self.assertLess(found[0].contrast, 80, "a half-transparent paste should be low contrast")

    def test_a_clean_product_photograph_yields_no_mask(self):
        image = with_racket(canvas(800, 1000))
        for site in SITE_SETTINGS:
            with self.subTest(site):
                self.assertEqual(detect(image, TEMPLATES, site), [])
        self.assertEqual(detect(image, TEMPLATES), [])

    def test_an_empty_canvas_yields_no_mask(self):
        self.assertEqual(detect(canvas(700, 700), TEMPLATES), [])

    def test_restricting_to_a_site_ignores_other_shops_templates(self):
        image = paste(canvas(900, 900), BY_ID["qvbadminton/quoc-viet"], 300, 260)
        self.assertEqual(detect(image, TEMPLATES, "hvshop"), [])
        self.assertEqual(len(stamps(detect(image, TEMPLATES, "qvbadminton"))), 1)

    def test_two_overlays_on_one_photograph_are_both_found(self):
        image = canvas(1000, 1000)
        paste(image, BY_ID["fbshop/fbshop-vn-text"], 60, 420)
        paste(image, BY_ID["fbshop/fbshop-logo"], 700, 760)
        found = detect(image, TEMPLATES, "fbshop")
        self.assertEqual({match.template for match in found}, {"fbshop/fbshop-vn-text", "fbshop/fbshop-logo"})
        self.assertEqual(len(stamps(found)), 2)

    def test_a_raised_threshold_refuses_rather_than_guesses(self):
        # A synthetic paste correlates almost perfectly, so the thresholds that
        # must still reject it are the ones no real overlay could clear.
        image = paste(canvas(900, 900), BY_ID["vnb/vnb-logo"], 300, 260, alpha=0.5)
        self.assertEqual(len(stamps(detect(image, TEMPLATES, "vnb"))), 1)
        self.assertEqual(detect(image, TEMPLATES, "vnb", {"min_width": 4000}), [])
        self.assertEqual(detect(image, TEMPLATES, "vnb", {"min_contrast": 250.0}), [])
        self.assertEqual(detect(image, TEMPLATES, "vnb", {"min_score": 1.0}), [])

    def test_a_match_below_the_width_floor_is_not_reported(self):
        # The VNB floor is what separates a real logo from a shrunken one
        # correlating with a grip; nothing under it may be returned.
        floor = settings_for("vnb").min_width
        image = paste(with_racket(canvas(1500, 1500)), BY_ID["vnb/vnb-logo"], 700, 600)
        for match in detect(image, TEMPLATES, "vnb"):
            self.assertGreaterEqual(match.width, floor)


class Masking(unittest.TestCase):
    def test_the_mask_covers_the_ink_and_spares_the_rest_of_the_box(self):
        template = BY_ID["qvbadminton/quoc-viet"]
        image = paste(canvas(900, 900), template, 300, 260)
        found = detect(image, TEMPLATES, "qvbadminton")
        mask = build_mask(image.shape, found, TEMPLATES)
        self.assertEqual(mask.shape, image.shape[:2])
        match = found[0]
        box = mask[match.y : match.y + match.height, match.x : match.x + match.width]
        painted = float((box > 0).mean())
        self.assertGreater(painted, 0.1, "the overlay's own ink must be repainted")
        self.assertLess(painted, 0.95, "a bounding box would repaint the product behind it")
        self.assertEqual(int(mask.sum()), int(box.sum()), "nothing outside the match may be repainted")

    def test_a_pale_overlay_is_grown_further_than_a_solid_one(self):
        hv = paste(canvas(900, 900), BY_ID["hvshop/hvshop-shuttle"], 300, 300)
        qv = paste(canvas(900, 900), BY_ID["qvbadminton/quoc-viet"], 300, 300)
        hv_mask = build_mask(hv.shape, detect(hv, TEMPLATES, "hvshop"), TEMPLATES)
        qv_mask = build_mask(qv.shape, detect(qv, TEMPLATES, "qvbadminton"), TEMPLATES)
        hv_match = detect(hv, TEMPLATES, "hvshop")[0]
        qv_match = detect(qv, TEMPLATES, "qvbadminton")[0]
        hv_fill = (hv_mask > 0).sum() / (hv_match.width * hv_match.height)
        qv_fill = (qv_mask > 0).sum() / (qv_match.width * qv_match.height)
        self.assertGreater(hv_fill, qv_fill)

    def test_no_detections_means_no_mask(self):
        image = with_racket(canvas(800, 1000))
        self.assertEqual(int(build_mask(image.shape, [], TEMPLATES).sum()), 0)

    def test_an_overlay_clipped_by_the_canvas_edge_does_not_overflow(self):
        # QV stamps the top-left corner, and its mark is sometimes cut off by
        # the edge; dilation must clip rather than index off the array.
        template = BY_ID["qvbadminton/quoc-viet"]
        image = paste(canvas(700, 700), template, 2, 0)
        found = detect(image, TEMPLATES, "qvbadminton")
        self.assertTrue(found)
        mask = build_mask(image.shape, found, TEMPLATES)
        self.assertEqual(mask.shape, image.shape[:2])
        self.assertGreater(int(mask.sum()), 0)


if __name__ == "__main__":
    unittest.main()


class Residual(unittest.TestCase):
    """The check that runs after repainting, so incomplete removal is reported."""

    def test_an_untouched_overlay_is_reported_as_residual(self):
        template = BY_ID["qvbadminton/quoc-viet"]
        image = paste(canvas(900, 900), template, 300, 260)
        found = detect(image, TEMPLATES, "qvbadminton")
        self.assertTrue(found)
        # Nothing was repainted, so the overlay is still exactly where it was.
        self.assertTrue(residual(image, found, TEMPLATES, "qvbadminton"))

    def test_a_repainted_overlay_leaves_nothing_behind(self):
        template = BY_ID["qvbadminton/quoc-viet"]
        image = paste(canvas(900, 900), template, 300, 260)
        found = detect(image, TEMPLATES, "qvbadminton")
        mask = build_mask(image.shape, found, TEMPLATES)
        # Flat fill stands in for inpainting: the mark is gone either way.
        cleaned = image.copy()
        cleaned[mask > 0] = 245
        self.assertEqual(residual(cleaned, found, TEMPLATES, "qvbadminton"), [])

    def test_nothing_repainted_means_nothing_to_check(self):
        self.assertEqual(residual(canvas(700, 700), [], TEMPLATES, "vnb"), [])

    def test_a_mark_elsewhere_is_not_counted_as_a_survivor(self):
        # Only the regions that were repainted are re-examined; an overlay the
        # run never touched is not this check's business.
        template = BY_ID["fbshop/fbshop-logo"]
        image = paste(canvas(1000, 1000), template, 700, 760)
        elsewhere = detect(paste(canvas(1000, 1000), template, 60, 60), TEMPLATES, "fbshop")
        self.assertTrue(elsewhere)
        self.assertEqual(residual(image, elsewhere, TEMPLATES, "fbshop"), [])


class MatchDomain(unittest.TestCase):
    """Matching on faint edges, which is how HVShop's large overlay is found."""

    def test_bandpass_keeps_faint_edges_and_drops_strong_ones(self):
        # Flat, so the only gradients are the ones drawn here.
        flat = np.full((400, 400), 250, dtype=np.uint8)
        faint = flat.copy()
        cv2.rectangle(faint, (80, 80), (200, 200), 238, 2)
        strong = flat.copy()
        cv2.rectangle(strong, (80, 80), (200, 200), 10, 2)
        # A racket's outline saturates any clip, so it is zeroed rather than
        # clipped; a pale overlay's edge is what survives.
        self.assertEqual(bandpass(flat).sum(), 0.0)
        self.assertGreater(bandpass(faint).sum(), 0.0)
        self.assertLess(bandpass(strong).sum(), bandpass(faint).sum() * 0.5)

    def test_an_edges_template_matches_on_edges_not_grey_levels(self):
        template = BY_ID.get("hvshop/hvshop-large")
        self.assertIsNotNone(template, "the large HVShop overlay should be installed")
        self.assertEqual(template.domain, "edges")
        self.assertIsNotNone(template.features)
        self.assertEqual(template.features.shape, template.gray.shape)
        # Its features are its faint gradients, not a copy of its grey levels.
        self.assertFalse(np.allclose(template.features, template.gray.astype(np.float32)))

    def test_a_pale_overlay_is_found_against_a_busy_photograph(self):
        # The case intensity correlation could not do: the window is dominated
        # by the product, and the overlay only shows in its faint edges.
        template = BY_ID["hvshop/hvshop-large"]
        height, width = template.gray.shape[:2]
        image = with_racket(canvas(width + 400, height + 400))
        image = paste(image, template, 200, 180, alpha=0.65)
        found = detect(image, TEMPLATES, "hvshop")
        self.assertTrue(found, "a pale overlay over a product should still be found")
        self.assertEqual(found[0].template, "hvshop/hvshop-large")
        self.assertAlmostEqual(found[0].x, 200, delta=25)
        self.assertAlmostEqual(found[0].y, 180, delta=25)
