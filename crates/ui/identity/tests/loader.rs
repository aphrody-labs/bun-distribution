// SPDX-License-Identifier: Apache-2.0
//! Chargeur d'images : chaque format, ICO multi-entrées (PNG et BMP 1/8/24/32 bits), SVG à
//! plusieurs tailles, glyphes Material Symbols comparés aux SVG exportés par Google
//! (`crates/ui/bun/tests/fixtures/icons`), cache, erreurs. Les fixtures raster sont encodées ici.

use std::{
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};

use aphrody_identity::loader::{
    CDN, Contenu, Fit, Format, LoadError, Loader, Output, Request, Source, SymboleSpec, couleur,
};
use aphrody_svg::{diff, raster};

fn rgba(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> image::RgbaImage {
    image::RgbaImage::from_fn(w, h, |x, y| image::Rgba(f(x, y)))
}

fn encoder(img: &image::DynamicImage, format: image::ImageFormat) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, format).expect("encodage");
    out.into_inner()
}

/// Dégradé opaque à gauche, transparent à droite.
fn motif() -> image::RgbaImage {
    rgba(40, 20, |x, y| {
        #[allow(clippy::cast_possible_truncation, reason = "x, y < 64")]
        let (r, g) = ((x * 6) as u8, (y * 12) as u8);
        [r, g, 200, if x < 20 { 255 } else { 0 }]
    })
}

fn charger(
    loader: &Loader,
    octets: Vec<u8>,
    req: Request,
) -> Arc<aphrody_identity::loader::Loaded> {
    loader.load(&Source::octets(octets), &req).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn png_jpeg_webp_gif() {
    let loader = Loader::new();
    let img = image::DynamicImage::ImageRgba8(motif());
    let cas = [
        (image::ImageFormat::Png, Format::Png, true),
        (image::ImageFormat::WebP, Format::WebP, true),
        (image::ImageFormat::Gif, Format::Gif, true),
        (image::ImageFormat::Jpeg, Format::Jpeg, false),
    ];
    for (codec, format, alpha) in cas {
        let source =
            if alpha { img.clone() } else { image::DynamicImage::ImageRgb8(img.to_rgb8()) };
        let l = charger(&loader, encoder(&source, codec), Request::default());
        assert_eq!(l.format, format);
        assert_eq!(l.intrinseque, (40, 20));
        let px = l.rgba().expect("rgba");
        assert_eq!((px.largeur, px.hauteur), (40, 20));
        let a = |x: usize, y: usize| px.rgba[(y * 40 + x) * 4 + 3];
        assert_eq!(a(5, 5), 255, "{format}");
        assert_eq!(a(35, 5), if alpha { 0 } else { 255 }, "{format} : alpha");
        if format == Format::Png || format == Format::WebP {
            assert_eq!(px.rgba, motif().into_raw(), "{format} sans perte");
        }
    }
}

#[test]
fn fit_scale_et_teinte_sur_raster() {
    let loader = Loader::new();
    let png = encoder(&image::DynamicImage::ImageRgba8(motif()), image::ImageFormat::Png);
    let dims = |req: Request| {
        let l = charger(&loader, png.clone(), req);
        let i = l.rgba().expect("rgba");
        (i.largeur, i.hauteur)
    };
    let r = |size, fit| Request { size: Some(size), fit, ..Request::default() };
    assert_eq!(dims(r(10, Fit::Contain)), (10, 5));
    assert_eq!(dims(r(10, Fit::Cover)), (10, 10));
    assert_eq!(dims(r(10, Fit::Fill)), (10, 10));
    assert_eq!(dims(r(10, Fit::None)), (40, 20));
    assert_eq!(dims(Request { scale: 2.0, ..r(10, Fit::Contain) }), (20, 10));
    assert_eq!(dims(Request { scale: 1.5, ..Request::default() }), (60, 30));

    let teinte = couleur("#6750a4").expect("couleur");
    let l = charger(&loader, png, Request { tint: Some(teinte), ..Request::default() });
    let i = l.rgba().expect("rgba");
    for px in i.rgba.as_chunks::<4>().0 {
        assert_eq!(&px[..3], &[0x67, 0x50, 0xa4]);
    }
    assert_eq!(i.rgba[3], 255);
    assert_eq!(i.rgba[(39) * 4 + 3], 0);
}

/// ICO de quatre entrées : 16 px BMP 1 bit, 32 px BMP 32 bits, 48 px BMP 24 bits, 64 px PNG
/// (opaque, donc déclaré 24 bits).
fn ico_multi() -> Vec<u8> {
    let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
    let ajouter = |dir: &mut ico::IconDir, img: image::RgbaImage, png: bool| {
        let (w, h) = img.dimensions();
        let icone = ico::IconImage::from_rgba_data(w, h, img.into_raw());
        let entree = if png {
            ico::IconDirEntry::encode_as_png(&icone)
        } else {
            ico::IconDirEntry::encode_as_bmp(&icone)
        };
        dir.add_entry(entree.expect("entrée"));
    };
    // Deux couleurs, alpha binaire : BMP 1 bit.
    ajouter(
        &mut dir,
        rgba(16, 16, |x, _| if x < 8 { [255, 0, 0, 255] } else { [0, 0, 0, 0] }),
        false,
    );
    // Alpha partiel : BMP 32 bits.
    ajouter(&mut dir, rgba(32, 32, |_, _| [0, 255, 0, 128]), false);
    // Plus de 256 couleurs, alpha binaire : BMP 24 bits.
    #[allow(clippy::cast_possible_truncation, reason = "< 256")]
    ajouter(&mut dir, rgba(48, 48, |x, y| [(x * 5) as u8, (y * 5) as u8, 7, 255]), false);
    ajouter(&mut dir, rgba(64, 64, |_, _| [0, 0, 255, 255]), true);
    let mut out = Vec::new();
    dir.write(&mut out).expect("ico");
    out
}

#[test]
fn ico_toutes_les_entrees_et_la_meilleure() {
    let octets = ico_multi();
    let loader = Loader::new();
    let l = charger(&loader, octets.clone(), Request::default());
    assert_eq!(l.format, Format::Ico);
    let bits: Vec<(u32, u16, bool)> =
        l.entrees.iter().map(|e| (e.largeur, e.bits, e.png)).collect();
    assert_eq!(bits, [(16, 1, false), (32, 32, false), (48, 24, false), (64, 24, true)]);
    assert_eq!(l.entree, Some(3), "sans taille : la plus grande");

    let pixel = |size: u32, scale: f32| {
        let l = charger(
            &loader,
            octets.clone(),
            Request { size: Some(size), scale, ..Request::default() },
        );
        let i = l.rgba().expect("rgba").clone();
        (l.entree, l.intrinseque, (i.largeur, i.hauteur), i.rgba[..4].to_vec())
    };
    assert_eq!(pixel(16, 1.0), (Some(0), (16, 16), (16, 16), vec![255, 0, 0, 255]));
    assert_eq!(pixel(20, 1.0), (Some(1), (32, 32), (20, 20), vec![0, 255, 0, 128]));
    assert_eq!(pixel(24, 2.0).0, Some(2), "24 px à 2x : l'entrée de 48");
    let (_, _, _, coin) = pixel(48, 1.0);
    assert_eq!(coin, vec![0, 0, 7, 255]);
    assert_eq!(pixel(64, 1.0).3, vec![0, 0, 255, 255]);
    assert_eq!(pixel(128, 1.0).0, Some(3), "au-delà : la plus grande, agrandie");
}

const CARRE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6"/></svg>"#;
const LARGE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="currentColor"/></svg>"#;

#[test]
fn svg_a_plusieurs_tailles() {
    let loader = Loader::new();
    for size in [16, 24, 48, 512] {
        let l = charger(&loader, CARRE.into(), Request::px(size));
        assert_eq!(l.format, Format::Svg);
        let i = l.rgba().expect("rgba");
        assert_eq!((i.largeur, i.hauteur), (size, size));
        let encre = i.rgba.as_chunks::<4>().0.iter().filter(|p| p[3] > 127).count();
        let attendu = f64::from(size * size) * 0.36;
        #[allow(clippy::cast_precision_loss, reason = "petits entiers")]
        let ecart = (encre as f64 - attendu).abs() / attendu;
        assert!(ecart < 0.15, "{size} px : {encre} pixels d'encre pour ~{attendu}");
    }
    let dims = |fit| {
        let l =
            charger(&loader, LARGE.into(), Request { size: Some(10), fit, ..Request::default() });
        let i = l.rgba().expect("rgba");
        (i.largeur, i.hauteur)
    };
    assert_eq!(dims(Fit::Contain), (10, 5));
    assert_eq!(dims(Fit::Cover), (10, 10));
    assert_eq!(dims(Fit::Fill), (10, 10));
    assert_eq!(dims(Fit::None), (40, 20));
}

#[test]
fn svg_en_sortie_svg_teinte_et_assaini() {
    let loader = Loader::new();
    let piege = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" onload="alert(1)"><script>alert(2)</script><rect width="40" height="20" fill="currentColor"/></svg>"#;
    let l = charger(
        &loader,
        piege.into(),
        Request {
            size: Some(20),
            tint: couleur("#6750a4"),
            output: Output::Svg,
            ..Request::default()
        },
    );
    let svg = l.svg().expect("svg");
    assert!(!svg.contains("script") && !svg.contains("onload"), "{svg}");
    assert!(svg.contains(r##"fill="#6750a4""##), "{svg}");
    assert!(svg.contains(r#"width="20""#) && svg.contains(r#"height="10""#), "{svg}");
}

fn dossier_polices() -> Option<PathBuf> {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3)?;
    let material = std::env::var_os("APHRODY_MATERIAL_CHECKOUT")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace.parent().expect("Aphrody workspace parent").join("material"));
    let d = material.join("packages/m3-fonts/fonts/upstream/material-symbols");
    d.join("material-symbols-outlined.woff2").is_file().then_some(d)
}

static POLICES: LazyLock<Option<Loader>> =
    LazyLock::new(|| dossier_polices().map(|d| Loader::new().with_symbol_dir(d)));

fn reference(fichier: &str) -> String {
    let chemin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../bun/tests/fixtures/icons").join(fichier);
    std::fs::read_to_string(&chemin).unwrap_or_else(|e| panic!("{}: {e}", chemin.display()))
}

/// Seuil de fidélité : rendus à 256 px, au plus 1 niveau d'écart par canal (anticrénelage).
#[test]
fn glyphes_fideles_au_svg_de_google() {
    let Some(loader) = POLICES.as_ref() else {
        eprintln!("polices Material Symbols absentes : bun packages/m3/scripts/fonts-sync.ts");
        return;
    };
    for (spec, fichier) in [
        ("home", "home_default.svg"),
        ("search", "search_default.svg"),
        ("settings", "settings_default.svg"),
        ("close", "close_default.svg"),
        ("favorite", "favorite_default.svg"),
        ("favorite?fill=1", "favorite_fill1.svg"),
    ] {
        let source = Source::Symbole(SymboleSpec::parse(spec).expect("spec"));
        let svg = loader
            .load(&source, &Request { output: Output::Svg, ..Request::default() })
            .unwrap_or_else(|e| panic!("{spec}: {e}"));
        let svg = svg.svg().expect("svg");
        let rapport = diff::diff_svg(&reference(fichier), svg, 256, 1).expect("diff");
        assert!(
            rapport.max_delta <= 1,
            "{spec}: écart max {} ({} pixels)",
            rapport.max_delta,
            rapport.mismatched_pixels
        );

        let l = loader.load(&source, &Request::px(48)).expect("rgba");
        let i = l.rgba().expect("rgba");
        let attendu =
            raster::render(&reference(fichier), raster::RenderOptions::square(48)).expect("rendu");
        let rapport = diff::diff_rgba(&attendu.rgba, &i.rgba, 48, 48, 1).expect("diff");
        assert_eq!(rapport.mismatched_pixels, 0, "{spec} en RGBA 48 px : {rapport:?}");
    }
}

#[test]
fn glyphes_styles_axes_et_inconnus() {
    let Some(loader) = POLICES.as_ref() else {
        eprintln!("polices Material Symbols absentes : bun packages/m3/scripts/fonts-sync.ts");
        return;
    };
    let svg = |spec: &str| {
        let s = Source::parse(spec).expect("spec");
        let l =
            loader.load(&s, &Request { output: Output::Svg, ..Request::default() }).expect(spec);
        l.svg().expect("svg").to_owned()
    };
    let base = svg("symbol:home");
    assert!(
        base.contains(r#"viewBox="0 -960 960 960""#) && base.contains(r#"width="24""#),
        "{base}"
    );
    // `home` a les mêmes contours en Outlined et en Sharp ; Rounded arrondit ses angles.
    let arrondi = svg("symbol:home?style=rounded");
    assert_eq!(svg("symbol:home?style=sharp"), base);
    assert_ne!(svg("symbol:settings?style=sharp"), svg("symbol:settings?style=rounded"));
    for variante in [
        "symbol:home?style=rounded",
        "symbol:home?fill=1",
        "symbol:home?wght=700",
        "symbol:home?grad=200",
        "symbol:home?opsz=48",
    ] {
        assert_ne!(svg(variante), base, "{variante}");
    }
    assert_ne!(arrondi, svg("symbol:home?style=rounded&fill=1"));
    let opsz = loader
        .load(&Source::parse("symbol:home?opsz=48").expect("spec"), &Request::default())
        .expect("rgba");
    assert_eq!(opsz.intrinseque, (48, 48));
    let r =
        loader.load(&Source::parse("symbol:no_such_symbol_xyz").expect("spec"), &Request::px(24));
    assert!(matches!(r, Err(LoadError::SymboleInconnu { .. })), "{r:?}");
}

#[test]
fn glyphe_depuis_le_cdn_sans_police() {
    let demandes = Arc::new(Mutex::new(Vec::<String>::new()));
    let journal = Arc::clone(&demandes);
    let loader = Loader::new().with_fetch(move |url: &str| {
        journal.lock().expect("journal").push(url.to_owned());
        if url.contains("/no_such_symbol_xyz/") {
            return Ok(None);
        }
        if url.contains("/boom/") {
            return Err("connexion refusée".into());
        }
        Ok(Some(reference("home_default.svg").into_bytes()))
    });
    let req = Request { output: Output::Svg, size: Some(32), ..Request::default() };
    let l = loader
        .load(&Source::parse("symbol:home?style=rounded&fill=1&wght=300").expect("spec"), &req)
        .expect("cdn");
    assert!(l.svg().expect("svg").contains(r#"width="32""#));
    let deux = loader
        .load(&Source::parse("symbol:home?style=rounded&fill=1&wght=300").expect("spec"), &req)
        .expect("cache");
    assert!(Arc::ptr_eq(&l, &deux));
    assert_eq!(
        *demandes.lock().expect("journal"),
        [format!("{CDN}s/i/short-term/release/materialsymbolsrounded/home/wght300fill1/24px.svg")]
    );
    let inconnu = loader.load(&Source::parse("symbol:no_such_symbol_xyz").expect("spec"), &req);
    assert!(matches!(inconnu, Err(LoadError::SymboleInconnu { .. })), "{inconnu:?}");
    let reseau = loader.load(&Source::parse("symbol:boom").expect("spec"), &req);
    assert!(matches!(reseau, Err(LoadError::Reseau { .. })), "{reseau:?}");
    let hors_cdn = loader.load(&Source::parse("symbol:home?opsz=30").expect("spec"), &req);
    assert!(matches!(hors_cdn, Err(LoadError::SymboleIndisponible(_))), "{hors_cdn:?}");
}

#[test]
fn urls_du_cdn_seulement() {
    let png = encoder(&image::DynamicImage::ImageRgba8(motif()), image::ImageFormat::Png);
    let servi = png.clone();
    let loader = Loader::new().with_fetch(move |_| Ok(Some(servi.clone())));
    let ok =
        loader.load(&Source::parse(&format!("{CDN}h/0123.png")).expect("url"), &Request::default());
    assert_eq!(ok.expect("cdn").format, Format::Png);
    for url in [
        "http://cdn.aphrody.com/h/a.png",
        "https://cdn.aphrody.com.evil.example/a.png",
        "https://evil.example/a.png",
        "https://cdn.aphrody.com/s/../../etc/passwd",
    ] {
        let r = loader.load(&Source::parse(url).expect("url"), &Request::default());
        assert!(matches!(r, Err(LoadError::UrlRefusee(_))), "{url}: {r:?}");
    }
    let sans = Loader::new()
        .load(&Source::parse(&format!("{CDN}h/a.png")).expect("url"), &Request::default());
    assert!(matches!(sans, Err(LoadError::SansReseau(_))), "{sans:?}");
}

#[test]
fn cache_par_empreinte_du_contenu() {
    let loader = Loader::new().with_capacity(2);
    let png = encoder(&image::DynamicImage::ImageRgba8(motif()), image::ImageFormat::Png);
    let a = charger(&loader, png.clone(), Request::px(10));
    let b = charger(&loader, png.clone(), Request::px(10));
    assert!(Arc::ptr_eq(&a, &b));
    let dir = std::env::temp_dir().join(format!("aphrody-loader-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dossier");
    let fichier = dir.join("copie.bin");
    std::fs::write(&fichier, &png).expect("écriture");
    let c = loader.load(&Source::Fichier(fichier.clone()), &Request::px(10)).expect("fichier");
    assert!(Arc::ptr_eq(&a, &c), "mêmes octets par un chemin : même entrée");
    assert_eq!(loader.en_cache(), 1);
    let _ = charger(&loader, png.clone(), Request::px(11));
    let _ = charger(&loader, CARRE.into(), Request::px(11));
    assert_eq!(loader.en_cache(), 2, "capacité respectée");
    let d = charger(&loader, png, Request::px(10));
    assert!(!Arc::ptr_eq(&a, &d), "l'entrée la plus ancienne est sortie");
    loader.vider();
    assert_eq!(loader.en_cache(), 0);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn erreurs_propres() {
    let loader = Loader::new();
    let essai = |octets: &[u8], req: Request| loader.load(&Source::octets(octets.to_vec()), &req);
    assert!(matches!(essai(b"bonjour", Request::default()), Err(LoadError::FormatInconnu)));
    assert!(matches!(essai(b"", Request::default()), Err(LoadError::FormatInconnu)));
    let png = encoder(&image::DynamicImage::ImageRgba8(motif()), image::ImageFormat::Png);
    assert!(matches!(
        essai(&png[..png.len() / 2], Request::default()),
        Err(LoadError::Decodage { format: Format::Png, .. })
    ));
    assert!(matches!(essai(b"GIF89a\x01", Request::default()), Err(LoadError::Decodage { .. })));
    assert!(matches!(
        essai(b"RIFF\0\0\0\0WEBPVP8 ", Request::default()),
        Err(LoadError::Decodage { .. })
    ));
    assert!(matches!(
        essai(b"\0\0\x01\0\x05\0tronque", Request::default()),
        Err(LoadError::Decodage { format: Format::Ico, .. })
    ));
    let mut ico = ico_multi();
    let n = ico.len();
    ico.truncate(n - 100);
    assert!(matches!(
        essai(&ico, Request::px(64)),
        Err(LoadError::Decodage { format: Format::Ico, .. })
    ));
    assert!(matches!(
        essai(b"<svg xmlns='http://www.w3.org/2000/svg'><rect", Request::default()),
        Err(LoadError::Decodage { format: Format::Svg, .. })
    ));
    assert!(matches!(
        essai(b"<svg xmlns='http://www.w3.org/2000/svg'/>", Request::default()),
        Err(LoadError::Decodage { format: Format::Svg, .. })
    ));
    let svg_sortie = Request { output: Output::Svg, ..Request::default() };
    assert!(matches!(essai(&png, svg_sortie), Err(LoadError::SortieSvg(Format::Png))));
    assert!(matches!(
        essai(&png, Request { scale: 0.0, ..Request::default() }),
        Err(LoadError::Requete(_))
    ));
    assert!(matches!(
        essai(&png, Request { scale: f32::NAN, ..Request::default() }),
        Err(LoadError::Requete(_))
    ));
    assert!(matches!(essai(&png, Request::px(0)), Err(LoadError::Requete(_))));
    assert!(matches!(essai(CARRE.as_bytes(), Request::px(100_000)), Err(LoadError::Requete(_))));
    let absent =
        loader.load(&Source::Fichier("introuvable/absent.png".into()), &Request::default());
    assert!(matches!(absent, Err(LoadError::Io { .. })), "{absent:?}");
    let sans_police =
        loader.load(&Source::parse("symbol:home?opsz=30").expect("spec"), &Request::default());
    assert!(matches!(sans_police, Err(LoadError::SymboleIndisponible(_))));
    assert!(matches!(Source::parse("symbol:Home"), Err(LoadError::SymboleInvalide(_))));
    // Les messages se lisent.
    let message = essai(b"bonjour", Request::default()).err().map(|e| e.to_string());
    assert_eq!(
        message.as_deref(),
        Some("format non reconnu (attendu PNG, JPEG, WebP, GIF, SVG ou ICO)")
    );
    let _ = Contenu::Svg(String::new());
}

#[test]
fn cli_charger() {
    let dossier = std::env::temp_dir().join(format!("aphrody-charger-{}", std::process::id()));
    std::fs::create_dir_all(&dossier).expect("dossier temporaire");
    let ico = dossier.join("multi.ico");
    std::fs::write(&ico, ico_multi()).expect("écriture ICO");
    let sortie = dossier.join("sortie.png");
    let lancer = |args: &[&str]| {
        let mut argv = vec!["charger".into()];
        argv.extend(args.iter().map(Into::into));
        aphrody_identity::charger_main(argv)
    };
    let (ico_s, sortie_s) =
        (ico.to_string_lossy().into_owned(), sortie.to_string_lossy().into_owned());
    assert_eq!(
        lancer(&[&ico_s, "--taille", "20", "--ajustement", "fill", "-o", &sortie_s, "--json"]),
        0
    );
    let png = image::open(&sortie).expect("PNG écrit").to_rgba8();
    assert_eq!(png.dimensions(), (20, 20));

    assert_eq!(lancer(&[]), 0, "sans argument : l'aide");
    assert_eq!(lancer(&[&ico_s]), 1, "une sortie RGBA exige -o");
    assert_eq!(lancer(&[&ico_s, "--taille", "abc", "-o", &sortie_s]), 1);
    assert_eq!(lancer(&[&ico_s, "--teinte", "violet", "-o", &sortie_s]), 1);
    assert_eq!(lancer(&[&ico_s, "--ajustement", "stretch", "-o", &sortie_s]), 1);
    assert_eq!(lancer(&[&ico_s, &ico_s, "-o", &sortie_s]), 1);
    assert_eq!(lancer(&["symbol:Home", "--svg"]), 1);
    assert_eq!(lancer(&["https://example.com/x.png", "-o", &sortie_s]), 1);
    let _ = std::fs::remove_dir_all(&dossier);
}
