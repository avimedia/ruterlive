# RuterLive – neste steg

**Checkpoint:** `checkpoint-2026-02` (2026-02-21)

---

## Planlagt: Holdeplasser på kart med avgangstavle

### Mål
- Vise alle holdeplasser på kartet med navn
- Ved klikk på holdeplass: avgangstavle med ankomster/avganger

### Datakilder
- **Koordinater + navn:** GTFS `stops.txt` (allerede lastet – 90k+ quays med lat/lon). Mangler `stop_name` i quay-coords-respons – utvid `parseStopsTxt` til også å returnere navn.
- **Avgangstavle:** Entur Journey Planner v3 GraphQL

### Entur API for avganger
**Base URL:** `https://api.entur.io/journey-planner/v3/graphql`  
** Dokumentasjon:** https://developer.entur.org/pages-journeyplanner-journeyplanner  
**GraphQL IDE:** https://api.entur.io/graphql-explorer/journey-planner-v3

**Eksempel – avgangstavle for StopPlace:**
```graphql
{
  stopPlace(id: "NSR:StopPlace:548") {
    id
    name
    estimatedCalls(timeRange: 72100, numberOfDepartures: 10) {
      realtime
      aimedArrivalTime
      aimedDepartureTime
      expectedArrivalTime
      expectedDepartureTime
      destinationDisplay { frontText }
      quay { id }
      serviceJourney {
        journeyPattern {
          line { id name publicCode transportMode }
        }
      }
    }
  }
}
```

- `timeRange`: sekunder frem i tid (72100 ≈ 20t)
- `numberOfDepartures`: antall avganger

**Quay vs StopPlace:** GTFS bruker `NSR:Quay:XXX` (enkelte plattformer). `NSR:StopPlace:XXX` er overordnet stoppested (kan ha flere quays). For avgangstavle er StopPlace vanlig – viser alle avganger. For quay: sjekk om `quay(id: "...") { estimatedCalls(...) }` finnes i schema.

### Teknisk tilnærming
1. **Stopp-markører:** Bruk GTFS stops (server har koordinater). Ved zoom X+ vis små markører. Filtrer på synlig kartutsnitt (bbox) – 90k er for mange å tegne samtidig.
2. **Server-endepunkt:** `GET /api/stops-in-bbox?minLat=...&maxLat=...&minLon=...&maxLon=...` – returnerer quays med id, navn, lat, lon innenfor bbox.
3. **Avgangstavle:** `GET /api/departures?stopPlaceId=NSR:StopPlace:XXX` eller `quayId=NSR:Quay:XXX` – proxy til JP GraphQL `stopPlace`/`quay` med `estimatedCalls`.
4. **UI:** Popup/panel ved klikk på stopp med avgangsliste.
