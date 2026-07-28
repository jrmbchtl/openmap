DOMAIN = "openmap"

CONF_OVERLAYS = "overlays"
CONF_DATA_URL = "data_url"
CONF_OVERLAY_TYPE = "overlay_type"
CONF_MARKER_CONFIG = "marker_config"
CONF_FILTER_BBOX = "filter_bbox"
CONF_UPDATE_INTERVAL = "update_interval"

STORAGE_KEY = f"{DOMAIN}_overlays"
STORAGE_VERSION = 1

SERVICE_REGISTER_OVERLAY = "register_overlay"
SERVICE_UNREGISTER_OVERLAY = "unregister_overlay"

EVENT_OVERLAY_UPDATED = f"{DOMAIN}_overlay_updated"
