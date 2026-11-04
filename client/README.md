# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Nearby distance setup

The "Find nearby" feature uses browser location permission and Google Maps geocoding to estimate distances from listing location text. It does not send the visitor's device coordinates to Google; distances are calculated in the browser. Listing location text is sent to Google Maps for geocoding.

Create `client/.env.local` and add a Google Maps Platform key:

```env
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

Enable the Maps JavaScript API and Geocoding API, and configure billing in Google Cloud. Since Vite exposes `VITE_` values in the browser, restrict this key to your site's HTTP referrers (including local development) and to the required APIs. Browser geolocation requires HTTPS in production; `localhost` works for local development.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
