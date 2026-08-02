"""Config flow for Open Map integration."""

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.selector import (
    EntityFilterSelectorConfig,
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
        """Initialize options flow."""
        self._config_entry = config_entry

    @property
    def config_entry(self):
        return self._config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            # Clean up empty center coordinates - omit keys if empty
            cleaned_input = {k: v for k, v in user_input.items() if v != ""}
            return self.async_create_entry(title="", data=cleaned_input)

        # Merge options with data for backward compatibility fallback
        options = {**self.config_entry.data, **self.config_entry.options}

        data_schema = vol.Schema(
            {
                vol.Optional(
                    "title",
                    default=options.get("title", "Open Map"),
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "default_zoom",
                    default=options.get("default_zoom", 7),
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=1,
                        max=19,
                        step=1,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
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
                    "dark_mode",
                    default=options.get("dark_mode", "auto"),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=["auto", "light", "dark"],
                        mode=SelectSelectorMode.DROPDOWN,
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
                        filter=EntityFilterSelectorConfig(),
                        multiple=True,
                    )
                ),
                vol.Optional(
                    "geolocation_sources",
                    default=options.get("geolocation_sources", []),
                ): TextSelector(
                    TextSelectorConfig(
                        multiline=True,
                        type="text",
                    )
                ),
                vol.Optional(
                    "include_domains",
                    default=options.get("include_domains", []),
                ): TextSelector(
                    TextSelectorConfig(
                        multiline=True,
                        type="text",
                    )
                ),
                vol.Optional(
                    "marker_color_default",
                    default=options.get("marker_color_default", "red"),
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=["red", "orange", "green", "blue", "purple"],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    "marker_popup_title",
                    default=options.get("marker_popup_title", "friendly_name"),
                ): TextSelector(TextSelectorConfig()),
                vol.Optional(
                    "marker_popup_body",
                    default=options.get("marker_popup_body", ""),
                ): TextSelector(TextSelectorConfig()),
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)