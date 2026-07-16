// app.json is the static base config. This file exists only to inject the
// Google Maps API key (from .env.local / CI secrets) into the react-native-maps
// plugin at prebuild time — app.json is plain JSON and can't reference
// process.env, so "process.env.GOOGLE_MAPS_API_KEY" written there would be
// taken as a literal string, not evaluated.
module.exports = ({ config }) => ({
  ...config,
  plugins: config.plugins.map(plugin => {
    if (plugin === 'react-native-maps') {
      return [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
          iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      ];
    }
    return plugin;
  }),
});
