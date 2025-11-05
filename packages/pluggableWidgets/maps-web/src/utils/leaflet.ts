import { TileLayerProps } from "react-leaflet";
import { MapProviderEnum, MapboxStyleEnum, MapboxTileSizeEnum } from "../../typings/MapsProps";

const customUrls = {
    openStreetMap: "https://{s}.tile.osm.org/{z}/{x}/{y}.png",
    mapbox: "https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}",
    hereMaps: "https://2.base.maps.cit.api.here.com/maptile/2.1/maptile/newest/normal.day/{z}/{x}/{y}/256/png8"
};

const mapAttr = {
    openStreetMapAttr: "&copy; <a href='https://osm.org/copyright'>OpenStreetMap</a> contributors",
    mapboxAttr:
        "Map data &copy; <a href='https://www.openstreetmap.org/'>OpenStreetMap</a> contributors, <a href='https://creativecommons.org/licenses/by-sa/2.0/'>CC-BY-SA</a>, Imagery © <a href='https://www.mapbox.com/'>Mapbox</a>",
    hereMapsAttr: "Map &copy; 1987-2020 <a href='https://developer.here.com'>HERE</a>"
};

export function baseMapLayer(
    mapProvider: MapProviderEnum,
    mapsToken?: string,
    mapboxStyle?: MapboxStyleEnum,
    mapboxTileSize?: MapboxTileSizeEnum
): TileLayerProps {
    let url;
    let attribution;
    let apiKey = "";

    if (mapProvider === "mapBox") {
        // Map enum keys to actual Mapbox style IDs
        const styleMapping: Record<string, string> = {
            streets: "streets-v12",
            outdoors: "outdoors-v12",
            light: "light-v11",
            dark: "dark-v11",
            satellite: "satellite-v9",
            satelliteStreets: "satellite-streets-v12",
            navigationDay: "navigation-day-v1",
            navigationNight: "navigation-night-v1"
        };

        // Use the selected style or fallback to satellite-streets-v12
        const selectedStyleKey = mapboxStyle || "satelliteStreets";
        const actualStyleId = styleMapping[selectedStyleKey] || "satellite-streets-v12";

        // Map tile size enum to actual values and zoom offsets
        const tileSizeConfigs: Record<
            string,
            { tileSize: number; zoomOffset: number; urlModifier: (url: string) => string }
        > = {
            highDetail: {
                tileSize: 256,
                zoomOffset: 0,
                urlModifier: url => url.replace("/tiles/{z}", "/tiles/256/{z}")
            },
            standard: {
                tileSize: 512,
                zoomOffset: -1,
                urlModifier: url => url // No modification for 512px (default)
            },
            retina: {
                tileSize: 512,
                zoomOffset: -1,
                urlModifier: url => url.replace("/{z}/{x}/{y}", "/{z}/{x}/{y}@2x")
            }
        };

        // Use the selected tile size or fallback to standard
        const selectedTileSizeKey = mapboxTileSize || "standard";
        const config = tileSizeConfigs[selectedTileSizeKey] || tileSizeConfigs.standard;

        // Build URL based on tile size configuration
        let baseUrl = customUrls.mapbox;
        baseUrl = config.urlModifier(baseUrl);

        if (mapsToken) {
            apiKey = `?access_token=${mapsToken}`;
        }
        url = baseUrl + apiKey;
        attribution = mapAttr.mapboxAttr;

        console.log(`[Mapbox Config] Style: ${selectedStyleKey} -> ${actualStyleId}`);
        console.log(`[Mapbox Config] Tile Size: ${selectedTileSizeKey} -> ${config.tileSize}px`);
        console.log(`[Mapbox Config] Zoom Offset: ${config.zoomOffset}`);
        console.log(`[Mapbox Config] Final URL template: ${baseUrl}`);

        return {
            url,
            attribution,
            id: `mapbox/${actualStyleId}`,
            tileSize: config.tileSize,
            zoomOffset: config.zoomOffset,
            maxNativeZoom: 20,
            maxZoom: 22
        };
    } else if (mapProvider === "hereMaps") {
        if (mapsToken && mapsToken.indexOf(",") > 0) {
            const splitToken = mapsToken.split(",");
            apiKey = `?app_id=${splitToken[0]}&app_code=${splitToken[1]}`;
        } else if (mapsToken) {
            apiKey = `?apiKey=${mapsToken}`;
        }
        url = customUrls.hereMaps + apiKey;
        attribution = mapAttr.hereMapsAttr;
        return {
            attribution,
            url,
            maxNativeZoom: 18, // HERE Maps conservative approach
            maxZoom: 20 // Allow oversampling beyond native zoom
        };
    } else {
        // OpenStreetMap (default)
        url = customUrls.openStreetMap;
        attribution = mapAttr.openStreetMapAttr;
        return {
            attribution,
            url,
            maxNativeZoom: 19, // OSM tiles available up to 19
            maxZoom: 22 // Allow oversampling beyond native zoom
        };
    }
}

/**
 * Get the maximum zoom level for a specific map provider
 */
export function getMaxZoomForProvider(mapProvider: MapProviderEnum): number {
    switch (mapProvider) {
        case "openStreet":
            return 22; // OSM with tile scaling beyond zoom 19
        case "mapBox":
            return 22; // Mapbox with good native support
        case "hereMaps":
            return 20; // HERE Maps conservative limit
        case "googleMaps":
            return 22; // Google Maps for consistency (handled elsewhere)
        default:
            return 18; // Safe fallback
    }
}
