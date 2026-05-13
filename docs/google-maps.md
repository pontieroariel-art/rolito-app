# Configuración de Google Maps

## APIs necesarias

En la [Google Cloud Console](https://console.cloud.google.com) habilitar:

1. **Maps JavaScript API** — Para el mapa del chofer
2. **Places API** — Para autocompletado de direcciones en el perfil del cliente
3. **Directions API** — Para calcular rutas optimizadas del chofer

## Variable de entorno

```env
VITE_GOOGLE_MAPS_KEY=AIzaSy...
```

## Uso en la app

### Autocompletado de direcciones

En la página de perfil del cliente (`ClientProfile.tsx`), se usa `StandaloneSearchBox` de `@react-google-maps/api` para autocompletar la dirección de entrega con Google Places.

### Mapa del chofer

En `ChoferMap.tsx`:
- Se muestra un mapa centrado en Buenos Aires (`-34.6037, -58.3816`) con estilo oscuro personalizado
- El chofer puede calcular una ruta optimizada entre todas sus entregas pendientes del día
- Usa `DirectionsService` con `optimizeWaypoints: true` para encontrar el orden óptimo
- También puede abrir todas las paradas en Google Maps externo

### Hook compartido

`useGoogleMapsLoader.ts` centraliza la carga del SDK de Google Maps con:
- Librería `places` precargada
- Idioma: `es` (español)
- Región: `AR` (Argentina)

## Restricción de API Key

Recomendado restringir la API key en la consola de Google Cloud:
- **HTTP referrers**: dominio de producción y `localhost:*` para desarrollo
- **APIs**: solo Maps JavaScript API, Places API y Directions API
