import { createElement, ReactElement, useEffect, useState } from "react";
import {
    MapContainer,
    Marker as MarkerComponent,
    Popup,
    TileLayer,
    useMap,
    GeoJSON,
    Polygon,
    useMapEvents
} from "react-leaflet";
import classNames from "classnames";
import { getDimensions } from "@mendix/widget-plugin-platform/utils/get-dimensions";
import { SharedProps } from "../../typings/shared";
import { MapProviderEnum } from "../../typings/MapsProps";
import { translateZoom } from "../utils/zoom";
import {
    latLngBounds,
    Icon as LeafletIcon,
    DivIcon,
    LeafletMouseEvent,
    LatLng
} from "leaflet";
import { baseMapLayer } from "../utils/leaflet";
import { ActionValue, EditableValue } from "mendix";
export interface LeafletProps extends SharedProps {
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

function SetBoundsComponent(props: Pick<LeafletProps, "autoZoom" | "currentLocation" | "locations">): null {
    const map = useMap();
    const { autoZoom, currentLocation, locations } = props;

    const bounds = latLngBounds(
        locations
            .concat(currentLocation ? [currentLocation] : [])
            .filter(m => !!m)
            .map(m => [m.latitude, m.longitude])
    );

    if (bounds.isValid()) {
        if (autoZoom) {
            map.flyToBounds(bounds, { padding: [0.5, 0.5], animate: false }).invalidateSize();
        } else {
            map.panTo(bounds.getCenter(), { animate: false });
        }
    }

    return null;
}

function ExposeMapInstance() {
    const map = useMap();

    useEffect(() => {
        console.log("Exposing Leaflet map instance globally");
        window.leafletMapInstance = map; // Attach the map instance to the global window object
    }, [map]);

    return null;
}

interface PolygonDrawerProps {
    drawing: boolean;
    polygonGeoJSON?: EditableValue<string>;
    onFinish(): void;
}

function PolygonDrawer({ drawing, polygonGeoJSON, onFinish }: PolygonDrawerProps): React.ReactElement | null {
    const [points, setPoints] = useState<LatLng[]>([]);

    useEffect(() => {
        if (!drawing) {
            setPoints([]);
        }
    }, [drawing]);

    useMapEvents({
        click: e => {
            if (!drawing) {
                return;
            }
            setPoints(prev => [...prev, e.latlng]);
        }
    });

    const finalize = () => {
        if (points.length >= 3 && polygonGeoJSON) {
            const coords = points.map(p => [p.lng, p.lat]);
            coords.push([points[0].lng, points[0].lat]);
            const geo = { type: "Polygon", coordinates: [coords] } as const;
            polygonGeoJSON.setValue(JSON.stringify(geo));
        }
        setPoints([]);
        onFinish();
    };

    if (!drawing) {
        return null;
    }

    return (
        <>
            {points.length > 0 && (
                <MarkerComponent
                    position={points[0]}
                    eventHandlers={{
                        click: e => {
                            e.originalEvent.stopPropagation();
                            finalize();
                        }
                    }}
                />
            )}
            {points.length > 0 && <Polygon positions={points} pathOptions={{ color: "blue" }} />}
        </>
    );
}

function GeoJSONLayer({
    geoJSON,
    onGeoJSONClick
}: {
    geoJSON?: string;
    onGeoJSONClick?: ActionValue;
}): React.ReactElement | null {
    const map = useMap();

    if (!geoJSON) {
        console.warn("No GeoJSON data provided.");
        return null;
    }

    const handleFeatureClick = (event: LeafletMouseEvent) => {
        if (onGeoJSONClick && onGeoJSONClick.canExecute) {
            console.log("GeoJSON feature clicked:", event);
            onGeoJSONClick.execute(); // Execute the Mendix action
        }
    };

    return (
        <GeoJSON
            data={JSON.parse(geoJSON)}
            ref={layer => {
                if (layer) {
                    // Adjust the map bounds to fit the GeoJSON layer
                    const bounds = layer.getBounds();
                    if (bounds.isValid()) {
                        map.fitBounds(bounds);
                    }
                }
            }}
            eventHandlers={{
                click: handleFeatureClick // Pass the wrapper function
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
        style,
        zoomLevel: zoom,
        optionDrag: dragging,
        geoJSON,
        onGeoJSONClick
    } = props;

    const [drawing, setDrawing] = useState(false);

    const handleFinishDrawing = () => setDrawing(false);

    console.log("[LeafletMap] GeoJSON passed to GeoJSONLayer:", geoJSON);

    return (
        <div className={classNames("widget-maps", className)} style={{ ...style, ...getDimensions(props) }}>
            <div className="widget-leaflet-maps-wrapper">
                <MapContainer
                    attributionControl={attributionControl}
                    center={center}
                    className="widget-leaflet-maps"
                    dragging={dragging}
                    maxZoom={18}
                    minZoom={1}
                    scrollWheelZoom={scrollWheelZoom}
                    zoom={autoZoom ? translateZoom("city") : zoom}
                    zoomControl={zoomControl}
                    whenReady={() => {}}
                >
                    <TileLayer {...baseMapLayer(mapProvider, mapsToken)} />
                    {locations
                        .concat(currentLocation ? [currentLocation] : [])
                        .filter(m => !!m)
                        .map((marker, index) => (
                            <MarkerComponent
                                icon={
                                    marker.url
                                        ? new DivIcon({
                                              html: `<img src="${marker.url}" class="custom-leaflet-map-icon-marker-icon" alt="map marker" />`,
                                              className: "custom-leaflet-map-icon-marker"
                                          })
                                        : defaultMarkerIcon
                                }
                                interactive={!!marker.title || !!marker.onClick}
                                key={`marker_${index}`}
                                eventHandlers={{
                                    click: marker.title ? undefined : marker.onClick
                                }}
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
                    <SetBoundsComponent autoZoom={autoZoom} currentLocation={currentLocation} locations={locations} />
                    <ExposeMapInstance />
                    {props.enablePolygonDrawing && (
                        <>
                            <button
                                className="widget-draw-polygon-btn"
                                onClick={() => setDrawing(d => !d)}
                            >
                                {drawing ? "Finish" : "Draw polygon"}
                            </button>
                            <PolygonDrawer drawing={drawing} polygonGeoJSON={props.polygonGeoJSON} onFinish={handleFinishDrawing} />
                        </>
                    )}
                    {geoJSON && <GeoJSONLayer geoJSON={geoJSON} onGeoJSONClick={onGeoJSONClick} />}
                </MapContainer>
            </div>
        </div>
    );
}
