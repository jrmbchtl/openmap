"""Content-first configuration with explicit, reversible clearing semantics."""

from typing import Any

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
import voluptuous as vol

from .config import DEFAULT_CONFIG, apply_form, canonical_config
from .const import DOMAIN
from .ludwigsburg_wms import LUDWIGSBURG_OVERLAY_PRESETS

DOMAIN_OPTIONS = [
    "zone",
    "device_tracker",
    "person",
    "sensor",
    "geo_location",
    "camera",
]
COLOR_OPTIONS = ["default", "red", "orange", "green", "blue", "purple"]


def content_schema(settings: dict) -> dict:
    """Never discover content implicitly; forms start with empty selections."""
    return {
        vol.Required(
            "entities",
            default=[
                e if isinstance(e, str) else e["entity"] for e in settings["entities"]
            ],
        ): EntitySelector(EntitySelectorConfig(multiple=True)),
        vol.Required(
            "overlay_layers", default=[e["preset"] for e in settings["overlay_layers"]]
        ): SelectSelector(
            SelectSelectorConfig(
                multiple=True, options=list(LUDWIGSBURG_OVERLAY_PRESETS)
            )
        ),
        vol.Required(
            "include_domains", default=settings["include_domains"]
        ): SelectSelector(SelectSelectorConfig(multiple=True, options=DOMAIN_OPTIONS)),
        vol.Optional(
            "geo_location_sources",
            description={
                "suggested_value": ", ".join(settings["geo_location_sources"])
            },
        ): TextSelector(TextSelectorConfig()),
    }


class OpenMapConfigFlow(ConfigFlow, domain=DOMAIN):
    """One sidebar panel per HA instance."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(
                title="Open Map", data=canonical_config(user_input)
            )
        schema = {
            vol.Required("title", default="Open Map"): TextSelector(
                TextSelectorConfig()
            ),
            **content_schema(DEFAULT_CONFIG),
        }
        return self.async_show_form(step_id="user", data_schema=vol.Schema(schema))

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> OpenMapOptionsFlowHandler:
        return OpenMapOptionsFlowHandler()


class OpenMapOptionsFlowHandler(OptionsFlow):
    """Keep rich YAML settings intact when editing simple selectors."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors = {}
        entry = self.config_entry
        if user_input is not None:
            try:
                settings = apply_form(dict(entry.data), dict(entry.options), user_input)
            except ValueError as error:
                errors["base"] = str(error)
            else:
                return self.async_create_entry(title="", data=settings)
        settings = canonical_config(dict(entry.data), dict(entry.options))
        center = settings["center"] or [None, None]
        color = settings["marker"]["color"]["default"]
        fields = content_schema(settings)
        fields.update(
            {
                vol.Required(
                    "title", default=settings["title"] or "Open Map"
                ): TextSelector(TextSelectorConfig()),
                vol.Required(
                    "default_zoom", default=settings["default_zoom"]
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=0, max=20, step=1, mode=NumberSelectorMode.BOX
                    )
                ),
                vol.Required(
                    "theme_mode", default=settings["theme_mode"]
                ): SelectSelector(
                    SelectSelectorConfig(options=["auto", "light", "dark"])
                ),
                vol.Required("basemap", default=settings["basemap"]): SelectSelector(
                    SelectSelectorConfig(options=["osm", "carto"])
                ),
                vol.Required("cluster", default=settings["cluster"]): BooleanSelector(),
                vol.Optional(
                    "center_lat", description={"suggested_value": center[0]}
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=-90, max=90, step=0.001, mode=NumberSelectorMode.BOX
                    )
                ),
                vol.Optional(
                    "center_lon", description={"suggested_value": center[1]}
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=-180, max=180, step=0.001, mode=NumberSelectorMode.BOX
                    )
                ),
                vol.Optional("clear_center", default=False): BooleanSelector(),
                vol.Optional(
                    "attribution",
                    description={"suggested_value": settings["attribution"]},
                ): TextSelector(TextSelectorConfig()),
                vol.Optional("carto_api_key"): TextSelector(
                    TextSelectorConfig(type=TextSelectorType.PASSWORD)
                ),
                vol.Optional("clear_carto_key", default=False): BooleanSelector(),
                vol.Optional("marker_color_default", default=color): TextSelector(
                    TextSelectorConfig()
                ),
                vol.Optional(
                    "marker_popup_title",
                    description={
                        "suggested_value": settings["marker"]["popup"]["title"]
                    },
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "marker_popup_body",
                    description={
                        "suggested_value": settings["marker"]["popup"]["body"]
                    },
                ): TextSelector(TextSelectorConfig()),
            }
        )
        return self.async_show_form(
            step_id="init", data_schema=vol.Schema(fields), errors=errors
        )
