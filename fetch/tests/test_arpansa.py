"""Tests for the ARPANSA adapter against the saved real feed."""
import os
import unittest
import xml.etree.ElementTree as ET

from ..arpansa import parse

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "arpansa-uvvalues.xml")


class ArpansaTests(unittest.TestCase):
    def test_parse_real_feed(self):
        with open(FIXTURE, "rb") as f:
            records = parse(f.read())
        self.assertEqual(len(records), 16)  # all stations ok in this snapshot
        adl = next(r for r in records if r.location == "au-adl")
        self.assertEqual(adl.uvi, 0.0)
        self.assertEqual(adl.kind, "measured")
        self.assertEqual(adl.valid_at.strftime("%Y-%m-%dT%H:%M"), "2026-10-23T12:48")

    def test_bad_status_is_dropped(self):
        xml = b"""<stations>
            <location id="X"><name>x1</name><index>5.0</index>
              <utcdatetime>2026/10/23 12:48</utcdatetime><status>fault</status></location>
            <location id="Y"><name>y1</name><index>7.4</index>
              <utcdatetime>2026/10/23 12:48</utcdatetime><status>ok</status></location>
        </stations>"""
        records = parse(xml)
        self.assertEqual([r.location for r in records], ["au-y1"])

    def test_out_of_range_index_dropped(self):
        xml = b"""<stations>
            <location id="Z"><name>z1</name><index>25.0</index>
              <utcdatetime>2026/10/23 12:48</utcdatetime><status>ok</status></location>
        </stations>"""
        self.assertEqual(parse(xml), [])

    def test_broken_xml_raises(self):
        with self.assertRaises(ET.ParseError):
            parse(b"<stations><broken")


if __name__ == "__main__":
    unittest.main()
