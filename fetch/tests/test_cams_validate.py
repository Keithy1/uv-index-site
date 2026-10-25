"""Tests for the validation maths."""
import unittest

from ..cams_validate import fit_multiplier


class FitMultiplierTests(unittest.TestCase):
    def test_recovers_a_known_multiplier(self):
        # measured = 40 * rate exactly
        pairs = [(40 * r, r) for r in (0.05, 0.1, 0.2, 0.25, 0.3)]
        self.assertAlmostEqual(fit_multiplier(pairs), 40.0)

    def test_recovers_a_wrong_multiplier(self):
        # If the data really implied 33, the fit must say 33 and not 40 --
        # otherwise the check cannot fail and is worthless.
        pairs = [(33 * r, r) for r in (0.05, 0.1, 0.2, 0.25, 0.3)]
        self.assertAlmostEqual(fit_multiplier(pairs), 33.0)

    def test_tolerates_scatter(self):
        pairs = [(40 * r + noise, r) for r, noise in
                 ((0.1, 0.3), (0.2, -0.4), (0.25, 0.2), (0.3, -0.1))]
        self.assertAlmostEqual(fit_multiplier(pairs), 40.0, delta=2.0)

    def test_no_data_gives_none(self):
        self.assertIsNone(fit_multiplier([]))
        self.assertIsNone(fit_multiplier([(5.0, 0.0)]))


if __name__ == "__main__":
    unittest.main()
