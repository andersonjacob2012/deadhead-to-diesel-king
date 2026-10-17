#!/usr/bin/env bash
# Downloads the public-domain source data used by build.py into $DK_MAP_SRC (default /workspace/mapwork/src).
set -euo pipefail
SRC=${DK_MAP_SRC:-/workspace/mapwork/src}; mkdir -p "$SRC"; cd "$SRC"
get(){ curl -fsSL -o "$(basename "$1")" "$1"; d=$(basename "$1" .zip); mkdir -p "${2:-$d}"; unzip -oq "$(basename "$1")" -d "${2:-$d}"; }
# Natural Earth (public domain): https://www.naturalearthdata.com/about/terms-of-use/
get https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip
get https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip
get https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip
get https://naciscdn.org/naturalearth/50m/physical/ne_50m_lakes.zip
get https://naciscdn.org/naturalearth/50m/raster/SR_50M.zip
# US Census Bureau cartographic boundary files (US federal government works, public domain)
get https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip
get https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_5m.zip
get https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip
get https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_ua20_500k.zip ua
echo "sources in $SRC"
