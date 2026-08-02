"""Config flow for Open Map integration."""

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.selector import (
    BooleanSelector,
    BooleanSelectorConfig,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
)

from .const import DOMAIN

DOMAIN_OPTIONS = ["zone", "device_tracker", "person", "sensor", "geo_location"]
COLOR_OPTIONS = ["red", "orange", "green", "blue", "purple"]


def _normalize_list(value):
    """Accept a comma-separated string or a list and return a clean list."""
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        return [item for item in value if item]
    return []


class OpenMapConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Open Map."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if user_input is not None:
            return self.async_create_entry(title="Open Map", data=user_input)

        data_schema = vol.Schema(
            {
                vol.Optional(
                    "title", default="Open Map"
                ): TextSelector(TextSelectorConfig()),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, description_placeholders={}
        )

    @staticmethod
    def async_get_options_flow(config_entry):
        """Get the options flow for this handler."""
        return OpenMapOptionsFlowHandler(config_entry)


class OpenMapOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle options flow for Open Map."""

    def __init__(self, config_entry):
        """Initialize options flow, compatible across HA versions.

        The base OptionsFlow initializes internal flow state (flow id, handler,
        source) in its constructor. Different HA versions accept a config_entry
        argument or none, so call super() defensively. Skipping super() leaves
        the flow state uninitialized and makes HA reject the flow with a 400.
        """
        try:
            super().__init__(config_entry)
        except TypeError:
            super().__init__()
        self._config_entry = config_entry
        self._handler = config_entry.domain

    @property
    def config_entry(self):
        return self._config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            cleaned_input = {}
            for k, v in user_input.items():
                if v is None or v == "":
                    continue
                if k in ("geolocation_sources", "include_domains"):
                    cleaned_input[k] = _normalize_list(v)
                elif k == "marker_color_default":
                    if "marker" not in cleaned_input:
                        cleaned_input["marker"] = {}
                    if "color" not in cleaned_input["marker"]:
                        cleaned_input["marker"]["color"] = {}
                    cleaned_input["marker"]["color"]["default"] = v
                else:
                    cleaned_input[k] = v
            return self.async_create_entry(title="", data=cleaned_input)

        # Merge options with data for backward compatibility fallback.
        options = {**self.config_entry.data, **self.config_entry.options}

        data_schema = vol.Schema(
            {
                vol.Optional(
                    "title",
                    default=options.get("title", "Open Map"),
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "default_zoom",
                    default=options.get("default_zoom", 14),
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=1,
                        max=20,
                        step=1,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    "theme_mode",
                    default=options.get("theme_mode")
                    or options.get("dark_mode", "auto"),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=["auto", "light", "dark"],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    "cluster",
                    default=options.get("cluster", True),
                ): BooleanSelector(BooleanSelectorConfig()),
                vol.Optional(
                    "center_lat",
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=-90,
                        max=90,
                        step=0.000001,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    "center_lon",
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=-180,
                        max=180,
                        step=0.000001,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    "attribution",
                    default=options.get("attribution", ""),
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "entities",
                    default=options.get("entities", []),
                ): EntitySelector(
                    EntitySelectorConfig(
                        multiple=True,
                    )
                ),
                vol.Optional(
                    "geolocation_sources",
                    default=", ".join(
                        _normalize_list(
                            options.get("geolocation_sources")
                            or options.get("geo_location_sources", [])
                        )
                    ),
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "include_domains",
                    default=_normalize_list(options.get("include_domains", [])),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=DOMAIN_OPTIONS,
                        multiple=True,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    "marker_color_default",
                    default=options.get("marker_color_default")
                    or options.get("marker", {}).get("color", {}).get("default", "default"),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=COLOR_OPTIONS,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    "marker_popup_title",
                    default=options.get("marker_popup_title")
                    or options.get("marker", {}).get("popup", {}).get("title", "friendly_name"),
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "marker_popup_body",
                    default=options.get("marker_popup_body")
                    or options.get("marker", {}).get("popup", {}).get("body", ""),
                ): TextSelector(TextSelectorConfig()),
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)