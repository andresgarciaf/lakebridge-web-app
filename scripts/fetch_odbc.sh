#!/usr/bin/env bash
# Vendors unixODBC libs + Microsoft ODBC Driver 18 for SQL Server (linux x64)
# for the Apps container, where apt is unavailable. By running this you accept
# the Microsoft ODBC driver EULA (https://aka.ms/odbc18eula).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fetch_deb() {
  local base=$1 pattern=$2 file
  file=$(curl -fsSL "$base/" | grep -oE "$pattern" | sort -uV | tail -1)
  [ -n "$file" ] || { echo "ERROR: no match for $pattern at $base" >&2; exit 1; }
  echo "fetching $file"
  curl -fsSL -o "$WORK/$file" "$base/$file"
}

fetch_deb "http://archive.ubuntu.com/ubuntu/pool/main/u/unixodbc" 'libodbc2_2\.3\.9[^"]*_amd64\.deb'
fetch_deb "http://archive.ubuntu.com/ubuntu/pool/main/u/unixodbc" 'libodbcinst2_2\.3\.9[^"]*_amd64\.deb'
fetch_deb "http://archive.ubuntu.com/ubuntu/pool/main/libt/libtool" 'libltdl7_2\.4\.6[^"]*_amd64\.deb'
fetch_deb "https://packages.microsoft.com/ubuntu/22.04/prod/pool/main/m/msodbcsql18" 'msodbcsql18_[^"]*_amd64\.deb'

ROOT="$WORK/root"
mkdir -p "$ROOT"
for deb in "$WORK"/*.deb; do
  d=$(mktemp -d "$WORK/deb.XXXXXX")
  (cd "$d" && ar -x "$deb")
  data=$(ls "$d"/data.tar.*)
  case "$data" in
    *.zst) zstd -dc "$data" | tar -x -C "$ROOT" ;;
    *) tar -xf "$data" -C "$ROOT" ;;
  esac
done

tar -czf "$WORK/odbc.tar.gz" -C "$ROOT" usr opt
rm -f vendor/odbc_libs_*
split -b 9m -a 2 "$WORK/odbc.tar.gz" vendor/odbc_libs_linux_x64.tar.gz.part-
ls -lh vendor/odbc_libs_*
