# Geocode Dar es Salaam landmarks with Photon (Komoot/OSM).
# Output: scripts/places.json
$ErrorActionPreference = 'Stop'
$places = @(
  'Kariakoo Market, Dar es Salaam',
  'Msimbazi Street, Dar es Salaam',
  'Fire Station, Morogoro Road, Dar es Salaam',
  'Magomeni, Dar es Salaam',
  'Ubungo Bus Terminal, Dar es Salaam',
  'Kimara, Dar es Salaam',
  'Mbagala, Dar es Salaam',
  'Tazara Railway Station, Dar es Salaam',
  'Julius Nyerere International Airport, Dar es Salaam',
  'Selander Bridge, Dar es Salaam',
  'Mwenge, Dar es Salaam',
  'Mbezi Beach, Dar es Salaam',
  'Kawe, Dar es Salaam',
  'Tegeta, Dar es Salaam',
  'Kigamboni, Dar es Salaam',
  'Kivukoni Ferry, Dar es Salaam',
  'Central Post Office, Dar es Salaam',
  'Askari Monument, Dar es Salaam',
  'Mlimani City, Dar es Salaam',
  'Tabata, Dar es Salaam',
  'Segerea, Dar es Salaam',
  'Ilala, Dar es Salaam',
  'Temeke, Dar es Salaam',
  'Chang''ombe, Dar es Salaam',
  'Mikocheni, Dar es Salaam',
  'Oyster Bay, Dar es Salaam',
  'Masaki, Dar es Salaam',
  'Mbagala Rangi Tatu, Dar es Salaam',
  'Gongo la Mboto, Dar es Salaam',
  'Salasala, Dar es Salaam',
  'Africana, Dar es Salaam',
  'Mwananyamala, Dar es Salaam',
  'Mabibo, Dar es Salaam',
  'Buguruni, Dar es Salaam',
  'Vingunguti, Dar es Salaam',
  'Kipawa, Dar es Salaam',
  'Ukonga, Dar es Salaam',
  'Mbezi Luis, Dar es Salaam',
  'Kunduchi, Dar es Salaam',
  'Bunju, Dar es Salaam',
  'Mbweni, Dar es Salaam',
  'Kigogo, Dar es Salaam',
  'Muhimbili National Hospital, Dar es Salaam',
  'Tandale, Dar es Salaam',
  'Manzese, Dar es Salaam',
  'Sinza, Dar es Salaam',
  'Kijitonyama, Dar es Salaam',
  'Magoni, Dar es Salaam',
  'Tandika, Dar es Salaam',
  'Yombo, Dar es Salaam',
  'Mtoni, Dar es Salaam',
  'Kurasini, Dar es Salaam',
  'Mbagala Kuu, Dar es Salaam',
  'Chalinze, Tanzania',
  'Bagamoyo, Tanzania'
)

function Get-Photon($q) {
  $url = 'https://photon.komoot.io/api/?limit=3&lang=en&lat=-6.8&lon=39.27&q=' + [uri]::EscapeDataString($q)
  $r = Invoke-RestMethod -Uri $url -TimeoutSec 25
  $features = @($r.features)
  if (-not $features) { return $null }
  $best = $features | Where-Object { $_.properties.country -eq 'Tanzania' } | Select-Object -First 1
  if (-not $best) { $best = $features[0] }
  [pscustomobject]@{
    query = $q
    name  = $best.properties.name
    city  = $best.properties.city
    street = $best.properties.street
    lat   = [double]$best.geometry.coordinates[1]
    lon   = [double]$best.geometry.coordinates[0]
  }
}

$out = @()
foreach ($p in $places) {
  try {
    $hit = Get-Photon $p
    if ($hit) { $out += $hit; Write-Host "OK   $p -> $($hit.lat),$($hit.lon) [$($hit.name)]" }
    else { Write-Host "MISS $p" }
  } catch {
    Write-Host "ERR  $p : $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 400
}
$out | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'places.json')
Write-Host "Saved $($out.Count) places"
