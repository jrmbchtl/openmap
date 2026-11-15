"""The backend and browser consume the same configuration-contract fixtures."""

import json
from pathlib import Path

import pytest

from custom_components.openmap.config import apply_form, canonical_config


@pytest.mark.parametrize(
    "case", json.loads(Path("tests/config_contract.json").read_text())
)
def test_shared_contract(case) -> None:
    result = canonical_config(case["input"])
    for key, value in case["expected"].items():
        assert result[key] == value


def test_clear_inherited_values_and_preserve_nested_settings() -> None:
    data = {
        "carto_api_key": "old-secret",
        "geo_location_sources": ["old"],
        "center": [49, 9],
        "marker": {
            "size": 52,
            "popup": {"fields": [{"label": "Name", "value": "friendly_name"}]},
        },
    }
    result = apply_form(
        data,
        {},
        {
            "clear_carto_key": True,
            "clear_center": True,
            "geo_location_sources": "",
            "marker_popup_body": "new",
        },
    )
    assert result["carto_api_key"] == ""
    assert result["center"] is None
    assert result["geo_location_sources"] == []
    assert result["marker"]["size"] == 52
    assert result["marker"]["popup"]["fields"] == data["marker"]["popup"]["fields"]
    assert result["marker"]["popup"]["body"] == "new"


def test_rich_content_roundtrip() -> None:
    data = {
        "entities": [{"entity": "person.alex", "name": "Custom", "color": "red"}],
        "overlay_layers": [
            {"preset": "bus", "name": "Buses", "visible": True, "opacity": 0.4}
        ],
    }
    result = apply_form(
        data, {}, {"entities": ["person.alex"], "overlay_layers": ["bus"]}
    )
    assert result["entities"] == data["entities"]
    assert result["overlay_layers"] == data["overlay_layers"]


def test_partial_center_rejected_and_options_alias_wins() -> None:
    with pytest.raises(ValueError, match="invalid_center"):
        canonical_config({"center_lat": 49})
    assert canonical_config({}, {"dark_mode": "dark"})["theme_mode"] == "dark"
