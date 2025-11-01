import { Marker } from "../../typings/shared";

export function getCurrentUserLocation(): Promise<Marker> {
    return new Promise<Marker>((resolve, reject) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                position => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        url: currentLocationMarkerImage
                    });
                },
                () => {
                    reject(new Error("Current user location is not available"));
                }
            );
        } else {
            reject(new Error("Current user location is not available"));
        }
    });
}

const currentLocationMarkerImage =
    "data:image/svg+xml;base64," +
    btoa(`
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="black" flood-opacity="0.3"/>
                </filter>
            </defs>
            <!-- Outer white border circle -->
            <circle cx="16" cy="16" r="12" fill="white" filter="url(#shadow)"/>
            <!-- Inner blue circle -->
            <circle cx="16" cy="16" r="9" fill="#2196F3"/>
        </svg>
    `);
