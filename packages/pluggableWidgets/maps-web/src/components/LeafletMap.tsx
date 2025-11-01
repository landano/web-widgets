import { createElement, ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { FeatureCollection } from "geojson";
import { GeoJSON, MapContainer, Marker as MarkerComponent, Popup, TileLayer, useMap } from "react-leaflet";
import classNames from "classnames";
import { getDimensions } from "@mendix/widget-plugin-platform/utils/get-dimensions";
import { GeoJSONFeature, SharedPropsWithDrawing } from "../../typings/shared";
import { MapProviderEnum } from "../../typings/MapsProps";
import { DivIcon, geoJSON, latLngBounds, Icon as LeafletIcon, LatLngBounds, DomEvent } from "leaflet";
import { baseMapLayer, getMaxZoomForProvider } from "../utils/leaflet";
import { executeAction } from "@mendix/widget-plugin-platform/framework/execute-action";
import {
    createLayersFromGeoJSON,
    getFeatureGroupLayers,
    layersToFeatureCollection,
    layerToGeoJSON
} from "../utils/drawing";
// Import leaflet-draw to extend Leaflet with drawing capabilities
import "leaflet-draw";
import * as L from "leaflet";
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

// Integrated Drawing Manager Component
function IntegratedDrawingManager(
    props: Pick<
        LeafletProps,
        "enableDrawing" | "drawingTools" | "drawnGeoJSONAttribute" | "onDrawComplete" | "allowEdit" | "allowDelete"
    >
): null {
    const map = useMap();
    const drawnItemsRef = useRef<L.FeatureGroup>();
    const drawControlRef = useRef<any>();
    const isDrawingActiveRef = useRef<boolean>(false);
    const isEditingActiveRef = useRef<boolean>(false);

    const { enableDrawing, drawingTools, drawnGeoJSONAttribute, onDrawComplete, allowEdit, allowDelete } = props;

    // Create stable callback functions
    const saveDrawnItems = useCallback(() => {
        if (!drawnItemsRef.current || !drawnGeoJSONAttribute || drawnGeoJSONAttribute.readOnly) {
            console.warn("SaveDrawnItems: Cannot save - missing requirements");
            return;
        }

        try {
            const layers = getFeatureGroupLayers(drawnItemsRef.current!);
            console.log(`SaveDrawnItems: Found ${layers.length} layers`);

            if (layers.length === 0) {
                drawnGeoJSONAttribute.setValue("");
                console.log("SaveDrawnItems: Cleared attribute - no drawings");
                return;
            }

            const result = layersToFeatureCollection(layers);
            if (result.success && result.featureCollection) {
                const geoJSONString = JSON.stringify(result.featureCollection);
                drawnGeoJSONAttribute.setValue(geoJSONString);
                console.log(`SaveDrawnItems: Successfully saved ${layers.length} drawings to attribute`);
            } else {
                console.error(`Failed to convert drawings to GeoJSON: ${result.error}`);
            }
        } catch (error) {
            console.error("SaveDrawnItems: Error:", error);
        }
    }, [drawnGeoJSONAttribute]);

    const loadExistingDrawings = useCallback(() => {
        if (!drawnItemsRef.current) {
            console.warn("LoadExistingDrawings: No drawn items ref available");
            return;
        }

        if (!drawnGeoJSONAttribute?.value || drawnGeoJSONAttribute.value.trim() === "") {
            console.log("LoadExistingDrawings: No existing drawings to load");
            return;
        }

        try {
            console.log("LoadExistingDrawings: Loading from attribute...");
            drawnItemsRef.current.clearLayers();

            const result = createLayersFromGeoJSON(drawnGeoJSONAttribute.value);
            if (result.success && result.layers.length > 0) {
                result.layers.forEach(layer => {
                    if (drawnItemsRef.current && layer) {
                        drawnItemsRef.current.addLayer(layer);
                    }
                });
                console.log(`LoadExistingDrawings: Successfully loaded ${result.layers.length} drawings`);
            } else {
                console.warn("LoadExistingDrawings: Failed to create layers:", result.error);
            }
        } catch (error) {
            console.error("LoadExistingDrawings: Unexpected error:", error);
            if (drawnItemsRef.current) {
                drawnItemsRef.current.clearLayers();
            }
        }
    }, [drawnGeoJSONAttribute]);

    useEffect(() => {
        if (!enableDrawing || !map) {
            return;
        }

        console.log("IntegratedDrawingManager: Initializing drawing functionality - coordinated with map lifecycle");

        // Wait for map to be ready then initialize controls
        const initializeDrawingControls = () => {
            try {
                console.log("IntegratedDrawingManager: Initializing drawing controls");

                // Initialize drawn items feature group
                const drawnItems = new L.FeatureGroup();
                map.addLayer(drawnItems);
                drawnItemsRef.current = drawnItems;

                // Configure drawing options
                const drawOptions =
                    drawingTools === "all"
                        ? {
                              polygon: {
                                  allowIntersection: false,
                                  showArea: false,
                                  shapeOptions: { color: "#2E7D32", fillColor: "#81C784", fillOpacity: 0.3, weight: 3 }
                              },
                              rectangle: {
                                  shapeOptions: { color: "#1565C0", fillColor: "#42A5F5", fillOpacity: 0.3, weight: 3 }
                              },
                              polyline: { shapeOptions: { color: "#E91E63", weight: 4 } },
                              circle: {
                                  shapeOptions: { color: "#7B1FA2", fillColor: "#BA68C8", fillOpacity: 0.3, weight: 3 }
                              },
                              circlemarker: false,
                              marker: true
                          }
                        : {
                              polygon: {
                                  allowIntersection: false,
                                  showArea: false,
                                  shapeOptions: { color: "#2E7D32", fillColor: "#81C784", fillOpacity: 0.3, weight: 3 }
                              },
                              rectangle: false,
                              polyline: false,
                              circle: false,
                              circlemarker: false,
                              marker: false
                          };

                // Initialize draw control
                const DrawControl = (L.Control as any).Draw;
                if (!DrawControl) {
                    console.error("Leaflet Draw control not loaded");
                    return;
                }

                const drawControl = new DrawControl({
                    position: "topright",
                    draw: drawOptions,
                    edit: {
                        featureGroup: drawnItems,
                        edit: allowEdit !== false ? {} : false,
                        remove: allowDelete !== false ? {} : false
                    }
                });

                map.addControl(drawControl);
                drawControlRef.current = drawControl;

                // Load existing drawings
                loadExistingDrawings();

                // Event handlers
                const onDrawCreated = (e: any): void => {
                    try {
                        const layer = e.layer;
                        if (!layer) {
                            console.error("No layer found in draw:created event");
                            return;
                        }

                        if (drawnItemsRef.current) {
                            drawnItemsRef.current.addLayer(layer);
                        }

                        saveDrawnItems();

                        if (onDrawComplete) {
                            executeAction(onDrawComplete);
                        }

                        console.log("Drawing created:", layerToGeoJSON(layer));
                    } catch (error) {
                        console.error("Error handling draw:created event:", error);
                    }
                };

                const onDrawEdited = (_e: any): void => {
                    saveDrawnItems();
                    console.log("Drawing edited");
                };

                const onDrawDeleted = (_e: any): void => {
                    saveDrawnItems();
                    console.log("Drawing deleted");
                };

                // Bind events
                const Draw = (L as any).Draw;
                if (Draw?.Event) {
                    map.on(Draw.Event.CREATED, onDrawCreated);
                    map.on(Draw.Event.EDITED, onDrawEdited);
                    map.on(Draw.Event.DELETED, onDrawDeleted);
                } else {
                    map.on("draw:created" as any, onDrawCreated);
                    map.on("draw:edited" as any, onDrawEdited);
                    map.on("draw:deleted" as any, onDrawDeleted);
                }

                console.log("IntegratedDrawingManager: Drawing controls initialized successfully");
            } catch (error) {
                console.error("IntegratedDrawingManager: Error during initialization:", error);
            }
        };

        // Initialize after a small delay to ensure map is stable
        const timer = setTimeout(initializeDrawingControls, 300);

        // Cleanup function
        return () => {
            clearTimeout(timer);

            if (drawControlRef.current) {
                map.removeControl(drawControlRef.current);
            }
            if (drawnItemsRef.current) {
                map.removeLayer(drawnItemsRef.current);
            }

            isDrawingActiveRef.current = false;
            isEditingActiveRef.current = false;
        };
    }, [
        enableDrawing,
        map,
        drawingTools,
        allowEdit,
        allowDelete,
        onDrawComplete,
        saveDrawnItems,
        loadExistingDrawings
    ]);

    // Update existing drawings when attribute value changes
    useEffect(() => {
        if (enableDrawing && drawnItemsRef.current && drawnGeoJSONAttribute?.value) {
            loadExistingDrawings();
        }
    }, [enableDrawing, drawnGeoJSONAttribute?.value, loadExistingDrawings]);

    return null;
}

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

    // Simple container check - no complex retry logic needed anymore
    const isMapReady = useCallback((): boolean => {
        const container = map.getContainer();
        return container && container.offsetWidth > 0 && container.offsetHeight > 0;
    }, [map]);

    useEffect(() => {
        console.log(
            "SetBoundsComponent useEffect - zoomTo:",
            zoomTo,
            "currentLocation:",
            currentLocation,
            "autoZoom:",
            autoZoom
        );

        // Wait for map to be ready before proceeding
        if (!isMapReady()) {
            console.log("SetBoundsComponent: Map container not ready, waiting...");
            const readyTimer = setTimeout(() => {
                // Trigger re-evaluation after a delay
                setBoundsSetForDataHash("");
            }, 100);
            return () => clearTimeout(readyTimer);
        }

        // Determine the zoom level to use
        const effectiveZoomLevel = autoZoom ? 15 : zoomLevel;

        // For drawing mode, we'll let the IntegratedDrawingManager handle location coordination
        // This should prevent the Washington DC fallback issues by ensuring better timing
        if (enableDrawing) {
            console.log("SetBoundsComponent: Drawing mode enabled - skipping separate location handling");
            return; // Let IntegratedDrawingManager handle location coordination
        }

        // Handle zoomTo option when not in drawing mode
        if (zoomTo === "currentLocation") {
            // Create a hash to prevent multiple zoom operations
            const currentLocationHash = JSON.stringify({
                zoomTo: "currentLocation",
                currentLocation: currentLocation ? `${currentLocation.latitude},${currentLocation.longitude}` : null,
                effectiveZoomLevel,
                mapReady: isMapReady()
            });

            if (currentLocationHash === boundsSetForDataHash) {
                return; // Already handled this zoom
            }

            if (currentLocation && isMapReady()) {
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
            autoZoom,
            mapReady: isMapReady()
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
            // Double-check map readiness
            if (!isMapReady()) {
                console.log("SetBoundsComponent: Map not ready during bounds setting, skipping");
                return;
            }

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
        showCurrentLocation,
        isMapReady
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

function MapInitializer(): null {
    const map = useMap();

    useEffect(() => {
        console.log("MapInitializer: Initializing map after React mount");

        // Single initialization after React has fully mounted
        const initTimer = setTimeout(() => {
            try {
                const container = map.getContainer();
                console.log("MapInitializer: Container dimensions:", {
                    offsetWidth: container.offsetWidth,
                    offsetHeight: container.offsetHeight,
                    clientWidth: container.clientWidth,
                    clientHeight: container.clientHeight
                });

                if (container.offsetWidth > 0 && container.offsetHeight > 0) {
                    console.log("MapInitializer: Container has dimensions, calling invalidateSize");
                    map.invalidateSize(true);
                } else {
                    console.warn("MapInitializer: Container has no dimensions - checking layout");

                    // Check if we're in a "percentage of width" layout
                    const parentWrapper = container.parentElement;
                    if (parentWrapper && parentWrapper.parentElement) {
                        const widgetContainer = parentWrapper.parentElement;
                        const computedStyle = window.getComputedStyle(widgetContainer);

                        console.log("MapInitializer: Widget container layout:", {
                            width: computedStyle.width,
                            height: computedStyle.height,
                            paddingBottom: computedStyle.paddingBottom,
                            display: computedStyle.display,
                            position: computedStyle.position
                        });

                        // Check if container is using padding-bottom trick (percentage of width)
                        const hasPaddingBottom = computedStyle.paddingBottom && computedStyle.paddingBottom !== "0px";

                        if (hasPaddingBottom) {
                            console.log(
                                "MapInitializer: Detected padding-bottom layout - ensuring wrapper has proper height"
                            );

                            // For padding-bottom layouts, the wrapper needs to expand to fill the space
                            parentWrapper.style.position = "absolute";
                            parentWrapper.style.top = "0";
                            parentWrapper.style.left = "0";
                            parentWrapper.style.right = "0";
                            parentWrapper.style.bottom = "0";

                            // Also ensure the container fills the wrapper
                            container.style.width = "100%";
                            container.style.height = "100%";

                            // Retry after layout fix
                            setTimeout(() => {
                                console.log("MapInitializer: Retrying after padding-bottom layout fix");
                                map.invalidateSize(true);
                            }, 100);
                        } else {
                            // Regular layout without padding-bottom
                            console.log("MapInitializer: Regular layout - setting explicit height");
                            widgetContainer.style.height = "350px";

                            setTimeout(() => {
                                console.log("MapInitializer: Retrying after height fix");
                                map.invalidateSize(true);
                            }, 100);
                        }
                    }
                }
            } catch (error) {
                console.warn("MapInitializer: Error during initialization:", error);
            }
        }, 100);

        // Simple resize observer for actual container size changes
        let resizeObserver: ResizeObserver | null = null;

        if (typeof window !== "undefined" && window.ResizeObserver) {
            const container = map.getContainer();
            if (container) {
                resizeObserver = new ResizeObserver(() => {
                    setTimeout(() => {
                        try {
                            map.invalidateSize(true);
                            console.log("MapInitializer: Handled resize event");
                        } catch (error) {
                            console.warn("MapInitializer: Error during resize:", error);
                        }
                    }, 50);
                });
                resizeObserver.observe(container);
            }
        }

        return () => {
            clearTimeout(initTimer);
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

    // Debug dimensions
    const dimensions = getDimensions(props);
    console.log("LeafletMap: getDimensions result:", dimensions);
    console.log("LeafletMap: style prop:", style);
    console.log("LeafletMap: width/height props:", {
        width: props.width,
        widthUnit: props.widthUnit,
        height: props.height,
        heightUnit: props.heightUnit
    });

    // Handle Mendix dimension system properly
    const ensuredDimensions = { ...dimensions };

    // Check if height unit is "percentage of width" (which uses padding-bottom trick)
    const isPercentageOfWidth = props.heightUnit === "percentageOfWidth";

    if (isPercentageOfWidth) {
        console.log("LeafletMap: Detected 'percentage of width' height unit - converting to explicit height");

        // For "percentage of width", Mendix uses padding-bottom trick
        // But Leaflet needs explicit height, so we convert it
        const paddingValue = ensuredDimensions.paddingBottom;

        if (paddingValue) {
            // Keep the padding-bottom for layout, but also set explicit height
            // This allows the aspect ratio to work while giving Leaflet a real height
            ensuredDimensions.height = "100%";
            ensuredDimensions.minHeight = "200px"; // Minimum reasonable height

            console.log("LeafletMap: Converted percentage-of-width to hybrid layout:", {
                paddingBottom: paddingValue,
                height: ensuredDimensions.height,
                minHeight: ensuredDimensions.minHeight
            });
        }
    } else {
        // For other height units, ensure we have a reasonable height
        if (!ensuredDimensions.height || ensuredDimensions.height === "auto" || ensuredDimensions.height === 0) {
            ensuredDimensions.height = "350px";
            ensuredDimensions.minHeight = "350px";
        }
    }

    console.log("LeafletMap: Final dimensions:", ensuredDimensions);

    return (
        <div className={classNames("widget-maps", className)} style={{ ...style, ...ensuredDimensions }}>
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
                    whenReady={() => {
                        console.log("MapContainer: Map is ready");
                    }}
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
                    <MapInitializer />
                    {features && <GeoJSONLayer features={features} featureHighlightColor={featureHighlightColor} />}
                    {enableDrawing && (
                        <IntegratedDrawingManager
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
