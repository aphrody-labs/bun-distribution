// SPDX-License-Identifier: Apache-2.0
//! Original schematic world graph for a Xenoverse 3-inspired prototype.
//!
//! Officially described places are tagged `announced`; connective spaces and
//! traversal routes are clearly tagged `prototype`. This is not a reconstruction
//! of an unreleased game's map and contains no extracted game assets.

use serde::{Deserialize, Serialize};

pub const SOURCE_WEST_CITY_TRAILER: &str = "https://en.bandainamcoent.eu/dragon-ball/news/become-the-hero-of-new-dragon-ball-era-dragon-ball-xenoverse-3";
pub const SOURCE_GAMESCOM_DEMO: &str =
    "https://en.bandainamcoent.eu/dragon-ball/news/dragon-ball-xenoverse-3-join-us-gamescom-2026";
pub const SOURCE_OFFICIAL_DEMO_REPORT: &str =
    "https://en.dragon-ball-official.com/news/01_4279.html";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatus {
    Announced,
    Prototype,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaceKind {
    Hub,
    District,
    Interior,
    MissionArea,
    Landmark,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TravelMode {
    Walk,
    Fly,
    Transit,
    MissionLaunch,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct MapPoint {
    pub x: f32,
    pub y: f32,
    pub elevation: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MapZone {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: PlaceKind,
    pub evidence: EvidenceStatus,
    pub source: &'static str,
    pub center: MapPoint,
    pub radius: f32,
    pub description: &'static str,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MapLandmark {
    pub id: &'static str,
    pub name: &'static str,
    pub zone_id: &'static str,
    pub kind: PlaceKind,
    pub evidence: EvidenceStatus,
    pub source: &'static str,
    pub position: MapPoint,
    pub description: &'static str,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MapRoute {
    pub id: &'static str,
    pub from: &'static str,
    pub to: &'static str,
    pub mode: TravelMode,
    pub distance: f32,
    pub evidence: EvidenceStatus,
    pub source: &'static str,
    pub description: &'static str,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Xenoverse3Map {
    pub schema_version: u32,
    pub title: &'static str,
    pub era: &'static str,
    pub status: &'static str,
    pub coordinate_system: &'static str,
    pub bounds: [f32; 3],
    pub zones: Vec<MapZone>,
    pub landmarks: Vec<MapLandmark>,
    pub routes: Vec<MapRoute>,
    pub caveat: &'static str,
}

/// Return a source-attributed, traversable schematic world graph for prototypes.
///
/// Coordinates, route distances, and unnamed connective spaces are original
/// design choices. The game's actual world map has not been published.
pub fn xenoverse3_prototype_map() -> Xenoverse3Map {
    let announced = EvidenceStatus::Announced;
    let prototype = EvidenceStatus::Prototype;
    Xenoverse3Map {
        schema_version: 1,
        title: "AGE 1000 — West City and Glacier Expedition",
        era: "AGE 1000",
        status: "original_prototype_schematic",
        coordinate_system: "local meters; x east, y north, elevation z; bounds are full dimensions centered at origin",
        bounds: [2400.0, 2000.0, 240.0],
        zones: vec![
            MapZone {
                id: "west-city",
                name: "West City",
                kind: PlaceKind::Hub,
                evidence: announced,
                source: SOURCE_WEST_CITY_TRAILER,
                center: MapPoint {
                    x: 0.0,
                    y: 0.0,
                    elevation: 0.0,
                },
                radius: 840.0,
                description: "Developed future-city hub named in the official AGE 1000 announcement.",
            },
            MapZone {
                id: "university-campus",
                name: "West City University campus",
                kind: PlaceKind::District,
                evidence: announced,
                source: SOURCE_WEST_CITY_TRAILER,
                center: MapPoint {
                    x: -460.0,
                    y: 280.0,
                    elevation: 0.0,
                },
                radius: 270.0,
                description: "University and student-life setting shown/described in official material.",
            },
            MapZone {
                id: "great-saiya-quarter",
                name: "Great Saiya Squad quarter",
                kind: PlaceKind::District,
                evidence: announced,
                source: SOURCE_WEST_CITY_TRAILER,
                center: MapPoint {
                    x: -220.0,
                    y: -210.0,
                    elevation: 0.0,
                },
                radius: 230.0,
                description: "Prototype placement for the announced squad activities in West City.",
            },
            MapZone {
                id: "capsule-quarter",
                name: "Capsule Corporation quarter",
                kind: PlaceKind::District,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                center: MapPoint {
                    x: 400.0,
                    y: 270.0,
                    elevation: 0.0,
                },
                radius: 260.0,
                description: "Original connective district for city exploration; exact boundaries are not published.",
            },
            MapZone {
                id: "central-plaza",
                name: "Central plaza",
                kind: PlaceKind::District,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                center: MapPoint {
                    x: 210.0,
                    y: -110.0,
                    elevation: 0.0,
                },
                radius: 230.0,
                description: "Original navigation landmark joining the prototype city routes.",
            },
            MapZone {
                id: "glacier-expedition",
                name: "Glacier expedition area",
                kind: PlaceKind::MissionArea,
                evidence: announced,
                source: SOURCE_GAMESCOM_DEMO,
                center: MapPoint {
                    x: -770.0,
                    y: -560.0,
                    elevation: 70.0,
                },
                radius: 410.0,
                description: "A glacier quest area was described for the Gamescom demo; this geometry is a prototype.",
            },
        ],
        landmarks: vec![
            MapLandmark {
                id: "university-main",
                name: "University main building",
                zone_id: "university-campus",
                kind: PlaceKind::Interior,
                evidence: announced,
                source: SOURCE_OFFICIAL_DEMO_REPORT,
                position: MapPoint {
                    x: -480.0,
                    y: 320.0,
                    elevation: 0.0,
                },
                description: "Campus anchor; interior layout is a prototype approximation.",
            },
            MapLandmark {
                id: "your-room",
                name: "Player room",
                zone_id: "university-campus",
                kind: PlaceKind::Interior,
                evidence: announced,
                source: SOURCE_OFFICIAL_DEMO_REPORT,
                position: MapPoint {
                    x: -555.0,
                    y: 420.0,
                    elevation: 12.0,
                },
                description: "The official demo report describes the story opening in the protagonist's room.",
            },
            MapLandmark {
                id: "squad-hq",
                name: "Great Saiya Squad briefing point",
                zone_id: "great-saiya-quarter",
                kind: PlaceKind::Landmark,
                evidence: announced,
                source: SOURCE_WEST_CITY_TRAILER,
                position: MapPoint {
                    x: -220.0,
                    y: -210.0,
                    elevation: 0.0,
                },
                description: "Original map marker for joining the announced squad.",
            },
            MapLandmark {
                id: "capsule-center",
                name: "Capsule Corporation landmark",
                zone_id: "capsule-quarter",
                kind: PlaceKind::Landmark,
                evidence: announced,
                source: SOURCE_WEST_CITY_TRAILER,
                position: MapPoint {
                    x: 430.0,
                    y: 330.0,
                    elevation: 0.0,
                },
                description: "Named landmark represented with original coordinates and geometry.",
            },
            MapLandmark {
                id: "west-city-plaza",
                name: "West City plaza",
                zone_id: "central-plaza",
                kind: PlaceKind::Landmark,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                position: MapPoint {
                    x: 210.0,
                    y: -110.0,
                    elevation: 0.0,
                },
                description: "Original player orientation landmark.",
            },
            MapLandmark {
                id: "monorail-station",
                name: "Transit station",
                zone_id: "central-plaza",
                kind: PlaceKind::Landmark,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                position: MapPoint {
                    x: 360.0,
                    y: -260.0,
                    elevation: 0.0,
                },
                description: "Original fast-travel node, not a confirmed named in-game station.",
            },
            MapLandmark {
                id: "glacier-outpost",
                name: "Glacier mission entry",
                zone_id: "glacier-expedition",
                kind: PlaceKind::MissionArea,
                evidence: announced,
                source: SOURCE_GAMESCOM_DEMO,
                position: MapPoint {
                    x: -770.0,
                    y: -560.0,
                    elevation: 70.0,
                },
                description: "Prototype mission entry for the officially described glacier demo area.",
            },
            MapLandmark {
                id: "quest-board",
                name: "Quest rendezvous",
                zone_id: "west-city",
                kind: PlaceKind::Landmark,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                position: MapPoint {
                    x: 30.0,
                    y: 40.0,
                    elevation: 0.0,
                },
                description: "Original gameplay marker for repeatable prototype missions.",
            },
        ],
        routes: vec![
            MapRoute {
                id: "west-city-to-plaza",
                from: "west-city",
                to: "central-plaza",
                mode: TravelMode::Walk,
                distance: 260.0,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                description: "Original hub entry route joining West City to the prototype district graph.",
            },
            MapRoute {
                id: "campus-to-squad",
                from: "university-campus",
                to: "great-saiya-quarter",
                mode: TravelMode::Walk,
                distance: 590.0,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                description: "Original pedestrian connection.",
            },
            MapRoute {
                id: "campus-to-plaza",
                from: "university-campus",
                to: "central-plaza",
                mode: TravelMode::Fly,
                distance: 720.0,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                description: "Original aerial traversal connection; flight through West City is officially described.",
            },
            MapRoute {
                id: "plaza-to-capsule",
                from: "central-plaza",
                to: "capsule-quarter",
                mode: TravelMode::Walk,
                distance: 490.0,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                description: "Original pedestrian connection.",
            },
            MapRoute {
                id: "squad-to-plaza",
                from: "great-saiya-quarter",
                to: "central-plaza",
                mode: TravelMode::Fly,
                distance: 610.0,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                description: "Original aerial connection.",
            },
            MapRoute {
                id: "plaza-to-campus-transit",
                from: "central-plaza",
                to: "university-campus",
                mode: TravelMode::Transit,
                distance: 720.0,
                evidence: prototype,
                source: SOURCE_WEST_CITY_TRAILER,
                description: "Fast-travel option for the prototype; not a confirmed released-game route.",
            },
            MapRoute {
                id: "city-to-glacier",
                from: "west-city",
                to: "glacier-expedition",
                mode: TravelMode::MissionLaunch,
                distance: 1800.0,
                evidence: prototype,
                source: SOURCE_GAMESCOM_DEMO,
                description: "Prototype mission transition to the glacier quest area shown in official demo material.",
            },
        ],
        caveat: "The actual Xenoverse 3 map is unreleased and unpublished. Announced locations are distinguished from original prototype geometry and connective routes; no game files, screenshots, meshes, or textures are included.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn map_has_unique_ids_and_valid_zone_references() {
        let map = xenoverse3_prototype_map();
        let zone_ids: HashSet<_> = map.zones.iter().map(|zone| zone.id).collect();
        assert_eq!(zone_ids.len(), map.zones.len());
        let landmark_ids: HashSet<_> = map.landmarks.iter().map(|landmark| landmark.id).collect();
        assert_eq!(landmark_ids.len(), map.landmarks.len());
        for landmark in &map.landmarks {
            assert!(
                zone_ids.contains(landmark.zone_id),
                "unknown landmark zone: {}",
                landmark.id
            );
        }
        for route in &map.routes {
            assert!(
                zone_ids.contains(route.from),
                "unknown route origin: {}",
                route.id
            );
            assert!(
                zone_ids.contains(route.to),
                "unknown route destination: {}",
                route.id
            );
            assert!(route.distance > 0.0);
        }
    }

    #[test]
    fn every_zone_is_reachable_from_west_city() {
        let map = xenoverse3_prototype_map();
        let mut reached = HashSet::from(["west-city"]);
        loop {
            let previous = reached.len();
            for route in &map.routes {
                if reached.contains(route.from) {
                    reached.insert(route.to);
                }
                if reached.contains(route.to) {
                    reached.insert(route.from);
                }
            }
            if reached.len() == previous {
                break;
            }
        }
        assert_eq!(reached.len(), map.zones.len());
    }

    #[test]
    fn zone_footprints_fit_bounds_and_contain_their_landmarks() {
        let map = xenoverse3_prototype_map();
        let [width, height, depth] = map.bounds;
        for zone in &map.zones {
            assert!(
                zone.center.x.abs() + zone.radius <= width / 2.0,
                "zone exceeds horizontal x bounds: {}",
                zone.id
            );
            assert!(
                zone.center.y.abs() + zone.radius <= height / 2.0,
                "zone exceeds horizontal y bounds: {}",
                zone.id
            );
            assert!(
                zone.center.elevation.abs() <= depth / 2.0,
                "zone center exceeds elevation bounds: {}",
                zone.id
            );
        }
        for landmark in &map.landmarks {
            let zone = map
                .zones
                .iter()
                .find(|zone| zone.id == landmark.zone_id)
                .unwrap();
            let dx = landmark.position.x - zone.center.x;
            let dy = landmark.position.y - zone.center.y;
            assert!(
                dx.hypot(dy) <= zone.radius,
                "landmark lies outside its zone: {}",
                landmark.id
            );
            assert!(
                landmark.position.x.abs() <= width / 2.0,
                "landmark exceeds x bounds"
            );
            assert!(
                landmark.position.y.abs() <= height / 2.0,
                "landmark exceeds y bounds"
            );
            assert!(
                landmark.position.elevation.abs() <= depth / 2.0,
                "landmark exceeds elevation bounds"
            );
        }
    }

    #[test]
    fn announced_places_are_cited_and_prototype_is_disclosed() {
        let map = xenoverse3_prototype_map();
        assert!(map.zones.iter().all(|zone| !zone.source.is_empty()));
        assert!(
            map.landmarks
                .iter()
                .all(|landmark| !landmark.source.is_empty())
        );
        assert!(map.routes.iter().all(|route| !route.source.is_empty()));
        assert!(map.caveat.contains("unreleased"));
        assert!(
            map.zones
                .iter()
                .any(|zone| zone.evidence == EvidenceStatus::Prototype)
        );
    }
}
