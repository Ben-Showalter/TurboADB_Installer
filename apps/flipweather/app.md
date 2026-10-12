---
name: FlipWeather
summary: Weather and radar for flip phones, using NOAA forecasts and NEXRAD radar. No API key needed.
repo: Ben-Showalter/FlipWeather
package: com.flipweather.app
order: 3
---
A weather app built for the Kyocera **E4810**, and light enough for older flips
like the E4610.

### What it does

- **Current conditions, hourly and daily forecasts**, mostly straight from
  NOAA. Days beyond the 7-day forecast come from Open-Meteo.
- **Radar** from NEXRAD (Iowa Environmental Mesonet), drawn without OpenGL so it
  runs on phones whose graphics drivers can't handle map libraries. Choose a
  light topographic map or a dark map; neither needs an API key.
- **Updates itself in the background**: the last data shows instantly, then
  refreshes when due. The "Updated" time turns green when fresh and red when
  it's over 20 minutes old.
- **NWS Forecast Discussion** from your local weather office (Options → NWS
  Forecast Discussion).
- **Keeps itself up to date**: checks for a new version about once a week.

### What the installer sets up

- **Location** access, for your local forecast.
- Lets it **install its own updates**.

[More on GitHub](https://github.com/Ben-Showalter/FlipWeather)
