use std::collections::BTreeMap;

use anyhow::{Context as _, Result, bail};
use koharu_scene::{
    AssetRole, DetectionLabel, EntityId, EntityOrigin, Geometry, OcrAnalysis, Origin, Point,
    RasterLayer, RasterLayerKind, Region, Snapshot, SourceText, Translation,
};
use serde::{Deserialize, Serialize};

/// One page's source dimensions, detected regions, and optional cleanup overlay.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PageResult {
    pub page: EntityId,
    pub width: f64,
    pub height: f64,
    pub regions: Vec<RegionResult>,
    /// Full-page transparent PNG layer produced by inpainting, when present.
    pub cleanup_layer_png: Option<Vec<u8>>,
    pub cleanup_provenance: Option<GenerationInfo>,
}

/// A scene region with original polygon and its linked recognized text.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RegionResult {
    pub id: EntityId,
    pub kind: String,
    pub label: Option<String>,
    pub polygon: Vec<Point>,
    /// Minimum x/y and maximum x/y in source page coordinates.
    pub bounds: [f64; 4],
    pub detection_labels: Vec<DetectionLabel>,
    pub confidence: Option<f32>,
    pub detection_provenance: Option<GenerationInfo>,
    pub texts: Vec<TextResult>,
}

/// Semantic text linked to a detected region through `RecognizedFrom`.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TextResult {
    pub id: EntityId,
    pub reading_order: Option<usize>,
    pub source: Option<String>,
    pub source_language: Option<String>,
    pub ocr_confidence: Option<f32>,
    pub ocr_provenance: Option<GenerationInfo>,
    pub translation: Option<String>,
    pub target_language: Option<String>,
    pub translation_provenance: Option<GenerationInfo>,
}

/// Provenance recorded on a generated scene component.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GenerationInfo {
    pub producer: String,
    pub model: Option<String>,
    pub confidence: Option<f32>,
}

impl GenerationInfo {
    fn from_origin(origin: &Origin) -> Option<Self> {
        let Origin::Generated(generation) = origin else {
            return None;
        };
        Some(Self {
            producer: generation.producer.as_str().to_owned(),
            model: generation.model.clone(),
            confidence: generation.confidence,
        })
    }
}

pub(super) async fn extract(snapshot: &Snapshot, page: EntityId) -> Result<PageResult> {
    let page_value = snapshot.page(page)?.page()?;
    let mut reading_order = BTreeMap::new();
    if let Some(group) = snapshot.page(page)?.text_group()? {
        for (index, layer) in group.text_layers()?.enumerate() {
            reading_order.insert(layer.content()?.id(), index);
        }
    }

    let mut regions = Vec::new();
    for entity in snapshot.descendants(page)? {
        let id = entity.id();
        let Some(Region { kind, label, .. }) = snapshot.component::<Region>(id)? else {
            continue;
        };
        let geometry = snapshot
            .component::<Geometry>(id)?
            .with_context(|| format!("region {id} has no geometry"))?;
        let bounds = bounds(&geometry)?;
        let detection = snapshot.component::<koharu_scene::DetectionAnalysis>(id)?;
        let detection_provenance = detection
            .as_ref()
            .and_then(|analysis| GenerationInfo::from_origin(&analysis.origin));
        let detection_labels = detection.map_or_else(Vec::new, |analysis| analysis.labels);
        let confidence = detection_labels
            .iter()
            .find(|label| label.kind == kind)
            .map(|label| label.confidence);
        let ocr = snapshot.component::<OcrAnalysis>(id)?;
        let mut texts = Vec::new();
        for relation in snapshot.relations_to_as::<koharu_scene::RecognizedFrom>(id) {
            let content = relation.value().source;
            let source = snapshot.component::<SourceText>(content)?;
            let translation = snapshot.component::<Translation>(content)?;
            texts.push(TextResult {
                id: content,
                reading_order: reading_order.get(&content).copied(),
                source: source.as_ref().map(|value| value.text.value.clone()),
                source_language: source
                    .as_ref()
                    .and_then(|value| value.language.as_ref())
                    .map(|language| language.as_str().to_owned()),
                ocr_confidence: ocr.as_ref().and_then(|value| value.confidence),
                ocr_provenance: source
                    .as_ref()
                    .and_then(|value| GenerationInfo::from_origin(&value.text.origin))
                    .or_else(|| {
                        ocr.as_ref()
                            .and_then(|value| GenerationInfo::from_origin(&value.origin))
                    }),
                translation: translation.as_ref().map(|value| value.text.value.clone()),
                target_language: translation
                    .as_ref()
                    .and_then(|value| value.language.as_ref())
                    .map(|language| language.as_str().to_owned()),
                translation_provenance: translation
                    .as_ref()
                    .and_then(|value| GenerationInfo::from_origin(&value.text.origin)),
            });
        }
        texts.sort_by_key(|text| text.reading_order);
        regions.push(RegionResult {
            id,
            kind: kind.as_str().to_owned(),
            label,
            polygon: geometry.points,
            bounds,
            detection_labels,
            confidence,
            detection_provenance,
            texts,
        });
    }

    let source = AssetRole::new("source")?;
    let mut cleanup_layer_png = None;
    let mut cleanup_provenance = None;
    for entity in snapshot.children(page)? {
        if let Some(layer) = snapshot.component::<RasterLayer>(entity)?
            && layer.kind == RasterLayerKind::Cleanup
            && let Some(asset) = snapshot.asset(entity, &source)?
        {
            if cleanup_layer_png.is_some() {
                bail!("page {page} has multiple cleanup image layers");
            }
            cleanup_layer_png = Some(snapshot.read_blob(asset.blob).await?.to_vec());
            cleanup_provenance = snapshot
                .component::<EntityOrigin>(entity)?
                .as_ref()
                .and_then(|lifecycle| GenerationInfo::from_origin(&lifecycle.origin))
                .or_else(|| GenerationInfo::from_origin(&layer.origin));
        }
    }

    Ok(PageResult {
        page,
        width: page_value.width,
        height: page_value.height,
        regions,
        cleanup_layer_png,
        cleanup_provenance,
    })
}

fn bounds(geometry: &Geometry) -> Result<[f64; 4]> {
    let first = geometry.points.first().context("region polygon is empty")?;
    let (mut left, mut top, mut right, mut bottom) = (first.x, first.y, first.x, first.y);
    for point in &geometry.points[1..] {
        left = left.min(point.x);
        top = top.min(point.y);
        right = right.max(point.x);
        bottom = bottom.max(point.y);
    }
    Ok([left, top, right, bottom])
}
