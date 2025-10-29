import { createElement, ReactElement, useEffect, useRef, useState } from "react";
import { FeatureCollection } from "geojson";
import { GeoJSON, MapContainer, Marker as MarkerComponent, Popup, TileLayer, useMap } from "react-leaflet";
import classNames from "classnames";
import { getDimensions } from "@mendix/widget-plugin-platform/utils/get-dimensions";
import { GeoJSONFeature, SharedPropsWithDrawing } from "../../typings/shared";
import { MapProviderEnum } from "../../typings/MapsProps";
import { DivIcon, geoJSON, latLngBounds, Icon as LeafletIcon, LatLngBounds, DomEvent } from "leaflet";
import { baseMapLayer, getMaxZoomForProvider } from "../utils/leaflet";
import { LeafletDrawing } from "./LeafletDrawing";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

export interface LeafletProps extends SharedPropsWithDrawing {
    mapProvider: MapProviderEnum;
    attributionControl: boolean;
}

/**
 * There is an ongoing issue in `react-leaflet` that fails to properly set the icon urls in the
 * default marker implementation. Issue https://github.com/PaulLeCam/react-leaflet/issues/453
 * describes the problem and also proposes a few solutions. But all of them require a hackish method
 * to override `leaflet`'s implementation of the default Icon. Instead, we always set the
 * `Marker.icon` prop instead of relying on the default. So if a custom icon is set, we use that.
 * If not, we reuse a leaflet icon that's the same as the default implementation should be.
 */
const defaultMarkerIcon = new LeafletIcon({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iconRetinaUrl: require("leaflet/dist/images/marker-icon.png"),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iconUrl: require("leaflet/dist/images/marker-icon.png"),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

function SetBoundsComponent(
    props: Pick<
        LeafletProps,
        | "autoZoom"
        | "currentLocation"
        | "locations"
        | "features"
        | "enableDrawing"
        | "zoomTo"
        | "zoomLevel"
        | "showCurrentLocation"
    >
): null {
    const map = useMap();
    const { autoZoom, currentLocation, locations, features, enableDrawing, zoomTo, zoomLevel, showCurrentLocation } =
        props;
    const [boundsSetForDataHash, setBoundsSetForDataHash] = useState<string>("");

    useEffect(() => {
        // Determine the zoom level to use (default to street level 15 if automatic)
        const effectiveZoomLevel = autoZoom ? 15 : zoomLevel;

        // Special handling for drawing mode - zoom to user location at street level
        if (enableDrawing) {
            // Create a hash to prevent multiple geolocation requests
            const drawingDataHash = JSON.stringify({
                enableDrawing: true,
                autoZoom
            });

            if (drawingDataHash === boundsSetForDataHash) {
                return; // Already handled this drawing mode setup
            }

            console.log("SetBoundsComponent: Drawing mode enabled - attempting to get user location");

            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    position => {
                        const userLat = position.coords.latitude;
                        const userLng = position.coords.longitude;
                        console.log(
                            `SetBoundsComponent: Got user location: ${userLat}, ${userLng} - zooming to street level`
                        );

                        // Zoom to user location at street level (zoom 16-17 is good for drawing)
                        map.setView([userLat, userLng], 16);
                        setBoundsSetForDataHash(drawingDataHash);
                    },
                    error => {
                        console.debug("SetBoundsComponent: Failed to get user location:", error.message);
                        // Fallback: set a reasonable zoom level at current map center
                        map.setZoom(16);
                        setBoundsSetForDataHash(drawingDataHash);
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 60000 // Cache location for 1 minute
                    }
                );
            } else {
                console.warn("SetBoundsComponent: Geolocation not supported - using default zoom");
                map.setZoom(16);
                setBoundsSetForDataHash(drawingDataHash);
            }
            return;
        }

        // Handle zoomTo option when not in drawing mode
        if (zoomTo === "currentLocation") {
            // Create a hash to prevent multiple zoom operations
            const currentLocationHash = JSON.stringify({
                zoomTo: "currentLocation",
                currentLocation: currentLocation ? `${currentLocation.latitude},${currentLocation.longitude}` : null,
                effectiveZoomLevel
            });

            if (currentLocationHash === boundsSetForDataHash) {
                return; // Already handled this zoom
            }

            if (currentLocation) {
                console.log(`SetBoundsComponent: Zooming to current location at zoom level ${effectiveZoomLevel}`);
                map.setView([currentLocation.latitude, currentLocation.longitude], effectiveZoomLevel);
                setBoundsSetForDataHash(currentLocationHash);
            } else {
                console.log("SetBoundsComponent: Current location not available yet, waiting...");
            }
            return;
        }

        // Check if drawing is active before proceeding
        const isDrawingActive =
            typeof window !== "undefined" &&
            (window as any).isLeafletDrawingActive &&
            (window as any).isLeafletDrawingActive();

        if (isDrawingActive) {
            console.log("SetBoundsComponent: Skipping bounds operations - drawing is active");
            return;
        }

        const allLocations = locations
            .concat(showCurrentLocation && currentLocation ? [currentLocation] : [])
            .filter(m => !!m);

        // Create a hash of current data to avoid setting bounds for the same data multiple times
        const dataHash = JSON.stringify({
            locationCount: allLocations.length,
            locations: allLocations.map(l => `${l.latitude},${l.longitude}`),
            featureCount: features?.length || 0,
            autoZoom
        });

        // If we've already set bounds for this exact data, skip
        if (dataHash === boundsSetForDataHash) {
            return;
        }

        console.log(
            `SetBoundsComponent: Data changed - Found ${allLocations.length} locations, ${features?.length || 0} features`
        );

        // If no locations AND no features, wait for data to load
        if (allLocations.length === 0 && (!features || features.length === 0)) {
            console.log("SetBoundsComponent: No data yet - waiting for locations or features to load");
            return; // Don't set the hash, keep waiting for data
        }

        // Wait a bit for the map to be fully ready, then set bounds
        const timer = setTimeout(() => {
            let bounds: LatLngBounds | null = null;

            // Create bounds from locations if available
            if (allLocations.length > 0) {
                bounds = latLngBounds(allLocations.map(m => [m.latitude, m.longitude]));
                console.log("SetBoundsComponent: Created bounds from locations");
            }

            // Add features to bounds if available
            if (features && features.length > 0) {
                try {
                    const featureCollection: FeatureCollection = {
                        type: "FeatureCollection",
                        features: features.map(feature => JSON.parse(feature.geoJSON))
                    };

                    const tempLayer = geoJSON(featureCollection);
                    const geoJsonBounds = tempLayer.getBounds();
                    if (geoJsonBounds.isValid()) {
                        if (bounds) {
                            bounds.extend(geoJsonBounds);
                            console.log("SetBoundsComponent: Extended bounds with features");
                        } else {
                            bounds = geoJsonBounds;
                            console.log("SetBoundsComponent: Created bounds from features only");
                        }
                    }
                } catch (error) {
                    console.warn("SetBoundsComponent: Error processing features for bounds:", error);
                }
            }

            // Apply bounds if valid
            if (bounds && bounds.isValid()) {
                if (autoZoom) {
                    console.log("SetBoundsComponent: Applying autoZoom with fitBounds");
                    map.fitBounds(bounds, { padding: [20, 20] });
                } else {
                    console.log("SetBoundsComponent: Setting view to bounds center");
                    map.setView(bounds.getCenter(), 13);
                }
                // Mark that we've set bounds for this data
                setBoundsSetForDataHash(dataHash);
            } else {
                console.warn("SetBoundsComponent: No valid bounds found - skipping zoom");
            }
        }, 200); // Slightly longer delay to allow for async data loading

        return () => clearTimeout(timer);
    }, [
        map,
        enableDrawing,
        autoZoom,
        locations,
        currentLocation,
        features,
        boundsSetForDataHash,
        zoomTo,
        zoomLevel,
        showCurrentLocation
    ]);

    return null;
}

function ExposeMapInstance(): null {
    const map = useMap();

    useEffect(() => {
        console.log("Exposing Leaflet map instance globally");
        window.leafletMapInstance = map; // Attach the map instance to the global window object

        // Removed problematic event handlers that were making coordinate offset worse
    }, [map]);

    return null;
}

function MapStabilizer(): null {
    const map = useMap();

    useEffect(() => {
        // Initial map stabilization after mount
        const initialTimer = setTimeout(() => {
            try {
                // Check if map container and its parent are properly initialized
                const container = map.getContainer();
                if (container && container.parentElement && container.offsetWidth > 0 && container.offsetHeight > 0) {
                    console.log("MapStabilizer: Initial map invalidateSize");
                    map.invalidateSize(true);
                } else {
                    console.log("MapStabilizer: Container not ready, skipping initial invalidateSize");
                }
            } catch (error) {
                console.warn("MapStabilizer: Error during initial invalidateSize:", error);
            }
        }, 300); // Increased delay to ensure container is ready

        // Set up ResizeObserver to handle container changes
        let resizeObserver: ResizeObserver | null = null;

        if (typeof window !== "undefined" && window.ResizeObserver) {
            const container = map.getContainer();
            if (container) {
                resizeObserver = new ResizeObserver(entries => {
                    // Check if drawing is active before invalidating size
                    const isDrawingActive =
                        typeof window !== "undefined" &&
                        (window as any).isLeafletDrawingActive &&
                        (window as any).isLeafletDrawingActive();

                    if (isDrawingActive) {
                        console.log("MapStabilizer: Skipping invalidateSize - drawing is active");
                        return;
                    }

                    for (const entry of entries) {
                        if (entry.target === container) {
                            console.log("MapStabilizer: Container resized, calling invalidateSize");
                            // Debounce resize calls
                            setTimeout(() => {
                                try {
                                    // Additional safety check before invalidating
                                    if (
                                        !(
                                            (window as any).isLeafletDrawingActive &&
                                            (window as any).isLeafletDrawingActive()
                                        ) &&
                                        container.offsetWidth > 0 &&
                                        container.offsetHeight > 0
                                    ) {
                                        map.invalidateSize(true);
                                    }
                                } catch (error) {
                                    console.warn("MapStabilizer: Error during resize invalidateSize:", error);
                                }
                            }, 100); // Increased delay
                        }
                    }
                });

                resizeObserver.observe(container);
            }
        }

        return () => {
            clearTimeout(initialTimer);
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    }, [map]);

    return null;
}

function GeoJSONLayer({
    features,
    featureHighlightColor
}: {
    features: GeoJSONFeature[];
    featureHighlightColor: string;
}): React.ReactElement | null {
    const map = useMap();
    const highlightedFeatureIdRef = useRef<string | null>(null);
    const geoJSONLayerRef = useRef<any>(null);

    // Apply highlighting function
    const applyHighlight = (featureId: string | null) => {
        console.log("Applying highlight to:", featureId);
        if (geoJSONLayerRef.current) {
            geoJSONLayerRef.current.setStyle((feature: any) => {
                const props = feature?.properties || {};
                const isHighlighted = props.featureId === featureId;

                if (isHighlighted) {
                    console.log("Highlighting feature:", props.featureId);
                    return {
                        stroke: props.stroke !== false,
                        color: featureHighlightColor,
                        weight: (props.weight || 3) + 2,
                        opacity: Math.min((props.opacity || 1) + 0.2, 1),
                        fill: props.fill !== false,
                        fillColor: featureHighlightColor,
                        fillOpacity: Math.min((props.fillOpacity || 0.2) + 0.2, 0.6)
                    };
                }

                return {
                    stroke: props.stroke !== false,
                    color: props.color || "#3388ff",
                    weight: props.weight !== undefined ? props.weight : 3,
                    opacity: props.opacity !== undefined ? props.opacity : 1.0,
                    fill: props.fill !== false,
                    fillColor: props.fillColor || props.color || "#3388ff",
                    fillOpacity: props.fillOpacity !== undefined ? props.fillOpacity : 0.2
                };
            });
        }
    };

    // Reapply highlight after layer is created/recreated
    useEffect(() => {
        if (geoJSONLayerRef.current && highlightedFeatureIdRef.current) {
            console.log("Layer recreated, reapplying highlight:", highlightedFeatureIdRef.current);
            applyHighlight(highlightedFeatureIdRef.current);
        }
    });

    // Clear highlight when clicking on the map background
    useEffect(() => {
        const handleMapClick = () => {
            console.log("Map background clicked, clearing highlight");
            highlightedFeatureIdRef.current = null;
            applyHighlight(null);
        };

        map.on("click", handleMapClick);

        return () => {
            map.off("click", handleMapClick);
        };
    }, [map]);

    if (!features || features.length === 0) {
        return null;
    }

    // const geoJSONData: FeatureCollection = {
    //     type: "FeatureCollection",
    //     features: features.map((feature) => ({
    //         type: "Feature",
    //         geometry: JSON.parse(feature.geoJSON),
    //         properties: {
    //             color: feature.color ?? "#3388ff",
    //             stroke: feature.stroke ?? true,
    //             weight: feature.weight ?? 3,
    //             opacity: feature.opacity ?? 1.0,
    //             fill: feature.fill ?? true,
    //             fillColor: feature.fillColor ?? "#3388ff",
    //             fillOpacity: feature.fillOpacity ?? 0.2,
    //             onClick: feature.onClickAttribute,
    //         },
    //     }))
    // };

    const geoJSONData: FeatureCollection = {
        type: "FeatureCollection",
        features: features.map((feature, index) => {
            const parsedGeoJSON = JSON.parse(feature.geoJSON); // Parse the full GeoJSON feature

            console.log("Feature:", feature);
            // Merge additional properties with the parsed properties
            return {
                ...parsedGeoJSON, // Use the parsed Feature as the base
                properties: {
                    ...parsedGeoJSON.properties, // Keep existing properties
                    featureId: `feature-${index}`, // Unique ID for highlighting
                    color: feature.color ?? "#3388ff",
                    stroke: feature.stroke ?? true,
                    weight: feature.weight ?? 3,
                    opacity: feature.opacity ?? 1.0,
                    fill: feature.fill ?? true,
                    fillColor: feature.fillColor ?? "#3388ff",
                    fillOpacity: feature.fillOpacity ?? 0.2,
                    onClick: feature.onClickAttribute // Add the click action
                }
            };
        })
    };

    return (
        <GeoJSON
            ref={geoJSONLayerRef}
            data={geoJSONData}
            style={feature => {
                // Apply styles from feature properties
                if (feature?.properties) {
                    const props = feature.properties;
                    return {
                        stroke: props.stroke !== false, // Handle stroke property
                        color: props.color || "#3388ff",
                        weight: props.weight !== undefined ? props.weight : 3,
                        opacity: props.opacity !== undefined ? props.opacity : 1.0,
                        fill: props.fill !== false,
                        fillColor: props.fillColor || props.color || "#3388ff", // Fallback to color if fillColor not set
                        fillOpacity: props.fillOpacity !== undefined ? props.fillOpacity : 0.2
                    };
                }
                // Default styles if no properties
                return {
                    stroke: true,
                    color: "#3388ff",
                    weight: 3,
                    opacity: 1.0,
                    fill: true,
                    fillColor: "#3388ff",
                    fillOpacity: 0.2
                };
            }}
            onEachFeature={(feature, layer) => {
                console.log("onEachFeature called for feature:", feature, "onClick:", feature.properties?.onClick);

                layer.on("click", e => {
                    // Stop propagation to prevent map click handler from firing
                    DomEvent.stopPropagation(e);

                    console.log("GeoJSON feature clicked, featureId:", feature.properties?.featureId);

                    // Handle highlighting - toggle if clicking the same feature
                    const featureId = feature.properties?.featureId;
                    console.log(
                        "Current highlightedFeatureId:",
                        highlightedFeatureIdRef.current,
                        "Clicked featureId:",
                        featureId
                    );
                    if (highlightedFeatureIdRef.current === featureId) {
                        console.log("Toggling off highlight");
                        highlightedFeatureIdRef.current = null;
                        applyHighlight(null);
                    } else {
                        console.log("Setting highlight to:", featureId);
                        highlightedFeatureIdRef.current = featureId || null;
                        applyHighlight(featureId || null);
                    }

                    // Execute onClick action if present
                    if (feature.properties?.onClick) {
                        try {
                            const action = feature.properties.onClick;
                            // Check if it's a function (already bound action) or an object with execute method
                            if (typeof action === "function") {
                                action();
                            } else if (action && typeof action === "object" && "execute" in action) {
                                // Check if the action can be executed
                                if (!action.canExecute || action.canExecute === true) {
                                    action.execute();
                                } else {
                                    console.log("GeoJSON onClick: Action cannot be executed");
                                }
                            } else {
                                console.warn("GeoJSON onClick: Invalid action format", action);
                            }
                        } catch (error) {
                            console.error("GeoJSON onClick: Error executing action", error);
                        }
                    }
                });
            }}
        />
    );
}

export function LeafletMap(props: LeafletProps): ReactElement {
    const center = { lat: 51.906688, lng: 4.48837 };
    const {
        autoZoom,
        attributionControl,
        className,
        currentLocation,
        locations,
        mapProvider,
        mapsToken,
        optionScroll: scrollWheelZoom,
        optionZoomControl: zoomControl,
        showCurrentLocation,
        style,
        zoomLevel: zoom,
        zoomTo,
        optionDrag: dragging,
        features,
        featureHighlightColor,
        enableDrawing,
        drawingTools,
        drawnGeoJSONAttribute,
        onDrawComplete,
        allowEdit,
        allowDelete
    } = props;

    // Get provider-specific maximum zoom level
    const maxZoom = getMaxZoomForProvider(mapProvider);
    console.log(`LeafletMap: Using maxZoom ${maxZoom} for provider ${mapProvider}`);
    console.log("[LeafletMap] Features: ", features);

    return (
        <div className={classNames("widget-maps", className)} style={{ ...style, ...getDimensions(props) }}>
            <div className="widget-leaflet-maps-wrapper">
                <MapContainer
                    attributionControl={attributionControl}
                    center={center}
                    className="widget-leaflet-maps"
                    dragging={dragging}
                    maxZoom={maxZoom}
                    minZoom={1}
                    scrollWheelZoom={scrollWheelZoom}
                    zoom={zoom}
                    zoomControl={zoomControl}
                    whenReady={() => {}}
                >
                    <TileLayer {...baseMapLayer(mapProvider, mapsToken)} />
                    {locations
                        .concat(showCurrentLocation && currentLocation ? [currentLocation] : [])
                        .filter(m => !!m)
                        .map(marker => (
                            <MarkerComponent
                                icon={
                                    marker.url
                                        ? new DivIcon({
                                              html: `<img src="${marker.url}" class="custom-leaflet-map-icon-marker-icon" alt="map marker" />`,
                                              className: "custom-leaflet-map-icon-marker",
                                              iconSize: [32, 32], // Set proper icon size
                                              iconAnchor: [16, 32] // Anchor at bottom center of icon
                                          })
                                        : defaultMarkerIcon
                                }
                                interactive={!!marker.title || !!marker.onClick}
                                key={`marker_${marker.id ?? marker.latitude + "_" + marker.longitude}`}
                                eventHandlers={marker.title ? undefined : { click: marker.onClick }}
                                position={{ lat: marker.latitude, lng: marker.longitude }}
                                title={marker.title}
                            >
                                {marker.title && (
                                    <Popup>
                                        <span
                                            style={{ cursor: marker.onClick ? "pointer" : "none" }}
                                            onClick={marker.onClick}
                                        >
                                            {marker.title}
                                        </span>
                                    </Popup>
                                )}
                            </MarkerComponent>
                        ))}
                    <SetBoundsComponent
                        autoZoom={autoZoom}
                        currentLocation={currentLocation}
                        locations={locations}
                        features={features}
                        enableDrawing={enableDrawing}
                        zoomTo={zoomTo}
                        zoomLevel={zoom}
                        showCurrentLocation={showCurrentLocation}
                    />
                    <ExposeMapInstance />
                    <MapStabilizer />
                    {features && <GeoJSONLayer features={features} featureHighlightColor={featureHighlightColor} />}
                    {enableDrawing && (
                        <LeafletDrawing
                            enableDrawing={enableDrawing}
                            drawingTools={drawingTools}
                            drawnGeoJSONAttribute={drawnGeoJSONAttribute}
                            onDrawComplete={onDrawComplete}
                            allowEdit={allowEdit}
                            allowDelete={allowDelete}
                        />
                    )}
                </MapContainer>
            </div>
        </div>
    );
}
