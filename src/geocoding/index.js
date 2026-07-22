import { NominatimGeocodingProvider } from "./providers/NominatimGeocodingProvider.js";

/**
 * The single place that picks the active geocoding backend. Everything else
 * (GeocodingService, and transitively the controller and the business
 * dashboard's location editor) imports `geocodingProvider` from here and only
 * ever calls methods defined on GeocodingProvider - moving to Mapbox's paid
 * permanent-geocoding endpoint later means writing one new *GeocodingProvider
 * class and changing the line below, nothing else.
 */
export const geocodingProvider = new NominatimGeocodingProvider();
