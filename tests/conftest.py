"""Fixtures for Open Map integration tests."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Generator
from pathlib import Path
from unittest.mock import AsyncMock, patch

from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.openmap.const import DOMAIN

TEST_DIST_FILE = "frontend/dist/openmap-card.js"


@pytest.fixture(autouse=True)
def enable_custom_integrations(hass: HomeAssistant) -> None:
    """Make the custom integration discoverable in tests."""
    hass.data.pop("custom_components")


@pytest.fixture(autouse=True)
async def mock_http(hass: HomeAssistant) -> AsyncGenerator[None]:
    """Provide hass.http without binding sockets or touching the router.

    The test harness leaves hass.http unset; construct the object directly
    and stub async_register_static_paths so tests never register real routes.
    """
    from homeassistant.components import http

    server = http.HomeAssistantHTTP(
        hass,
        ssl_certificate=None,
        ssl_peer_certificate=None,
        ssl_key=None,
        server_host=None,
        server_port=0,
        trusted_proxies=[],
        ssl_profile="modern",
    )
    hass.http = server

    with patch.object(
        type(server),
        "async_register_static_paths",
        new_callable=AsyncMock,
    ) as mock_reg:
        mock_reg.return_value = None
        yield


@pytest.fixture(autouse=True)
def mock_frontend_component():
    """Stub the frontend component's setup only.

    The real frontend component requires the hass_frontend wheel, which the
    test environment does not ship. The helpers this integration uses
    (async_register_built_in_panel, async_panel_exists, async_remove_panel,
    add_extra_js_url) are pure hass.data operations that do not need the
    component to be set up, so only async_setup is replaced. This keeps the
    production registration code path under test.
    """
    from homeassistant.components import frontend as frontend_component

    async def _frontend_setup(hass: HomeAssistant, config: dict) -> bool:
        hass.data[frontend_component.DATA_EXTRA_MODULE_URL] = (
            frontend_component.UrlManager(on_change=lambda *args: None, urls=[])
        )
        return True

    with patch.object(frontend_component, "async_setup", _frontend_setup):
        yield


@pytest.fixture(autouse=True)
def mock_built_card(hass: HomeAssistant) -> Generator[Path]:
    """Ensure the built card file exists so setup does not abort."""
    dist = Path(hass.config.path(f"custom_components/{DOMAIN}/{TEST_DIST_FILE}"))
    dist.parent.mkdir(parents=True, exist_ok=True)
    dist.write_text("// stub openmap card\n", encoding="utf8")
    yield dist


@pytest.fixture
def mock_config_entry(hass: HomeAssistant) -> MockConfigEntry:
    """Create a mocked config entry."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Open Map",
        data={CONF_NAME: "Open Map"},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    return entry
