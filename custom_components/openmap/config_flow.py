"""Config flow for Open Map integration."""

from typing import Any

from homeassistant import config_entries
from homeassistant.config_entries import (
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
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
import voluptuous as vol

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


class OpenMapConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Open Map."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        # The panel and card are global; a second entry would fight over the
        # same sidebar panel, so only one instance is allowed.
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Open Map", data=user_input)

        data_schema = vol.Schema(
            {
                vol.Required(
                    "title",
                    default="Open Map",
                ): TextSelector(TextSelectorConfig()),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, description_placeholders={}
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> OpenMapOptionsFlowHandler:
        """Get the options flow for this handler."""
        return OpenMapOptionsFlowHandler()


class OpenMapOptionsFlowHandler(OptionsFlow):
    """Handle options flow for Open Map.

    The base class exposes the owning entry as ``self.config_entry`` since
    2024.11; constructing it with an entry argument is deprecated and rejected
    in newer releases, so it must not be passed here.
    """

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            cleaned_input = {}
            for k, v in user_input.items():
                if v is None or v == "":
                    continue
                if k in ("geolocation_sources", "include_domains"):
                    cleaned_input[k] = _normalize_list(v)
                elif k == "marker_color_default":
                    marker = cleaned_input.setdefault("marker", {})
                    marker.setdefault("color", {})["default"] = v
                elif k == "marker_popup_title":
                    marker = cleaned_input.setdefault("marker", {})
                    marker.setdefault("popup", {})["title"] = v
                elif k == "marker_popup_body":
                    marker = cleaned_input.setdefault("marker", {})
                    marker.setdefault("popup", {})["body"] = v
                else:
                    cleaned_input[k] = v
            return self.async_create_entry(title="", data=cleaned_input)

        # Merge options with data for backward compatibility fallback.
        entry = self.config_entry
        options = {**entry.data, **entry.options}

        data_schema = vol.Schema(
            {
                vol.Required(
                    "title",
                    default=options.get("title", "Open Map"),
                ): TextSelector(TextSelectorConfig()),
                vol.Required(
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
                vol.Required(
                    "theme_mode",
                    default=options.get("theme_mode")
                    or options.get("dark_mode", "auto"),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=["auto", "light", "dark"],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Required(
                    "cluster",
                    default=options.get("cluster", True),
                ): BooleanSelector(BooleanSelectorConfig()),
                vol.Optional(
                    "center_lat",
                    description={"suggested_value": options.get("center_lat")},
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=-90,
                        max=90,
                        step=0.001,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    "center_lon",
                    description={"suggested_value": options.get("center_lon")},
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=-180,
                        max=180,
                        step=0.001,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
                vol.Required(
                    "attribution",
                    default=options.get("attribution", ""),
                ): TextSelector(TextSelectorConfig()),
                vol.Required(
                    "entities",
                    default=options.get("entities", []),
                ): EntitySelector(
                    EntitySelectorConfig(
                        multiple=True,
                    )
                ),
                vol.Optional(
                    "geolocation_sources",
                    description={
                        "suggested_value": ", ".join(
                            _normalize_list(
                                options.get("geolocation_sources")
                                or options.get("geo_location_sources", [])
                            )
                        )
                    },
                ): TextSelector(TextSelectorConfig()),
                vol.Required(
                    "include_domains",
                    default=_normalize_list(options.get("include_domains", [])),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=DOMAIN_OPTIONS,
                        multiple=True,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Required(
                    "marker_color_default",
                    default=options.get("marker_color_default")
                    or options.get("marker", {})
                    .get("color", {})
                    .get("default", "default"),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=COLOR_OPTIONS,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Required(
                    "marker_popup_title",
                    default=options.get("marker_popup_title")
                    or options.get("marker", {})
                    .get("popup", {})
                    .get("title", "friendly_name"),
                ): TextSelector(TextSelectorConfig()),
                vol.Required(
                    "marker_popup_body",
                    default=options.get("marker_popup_body")
                    or options.get("marker", {})
                    .get("popup", {})
                    .get("body", ""),
                ): TextSelector(TextSelectorConfig()),
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)
