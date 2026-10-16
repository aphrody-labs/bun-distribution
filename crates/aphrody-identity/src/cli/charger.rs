// SPDX-License-Identifier: Apache-2.0
//! `aphrody identity charger` — le chargeur d'images et d'icônes en ligne de commande.

use crate::loader::{Contenu, Fit, Loader, Output, Request, Source, couleur};
use std::ffi::OsString;
use std::time::Instant;

const AIDE: &str = "\
charger — une image ou une icône vers PNG ou SVG

  charger <SOURCE> [--taille PX] [--echelle F] [--teinte #RRGGBB[AA]]
          [--ajustement contain|cover|fill|none] [--svg] [-o FICHIER] [--json]

SOURCE : fichier (PNG, JPEG, WebP, GIF, SVG, ICO), URL https://cdn.aphrody.com/…, ou
symbol:<nom>?style=outlined|rounded|sharp&fill=0..1&wght=100..700&grad=-25..200&opsz=20..48.
Sans -o, le SVG va sur la sortie standard ; un PNG exige -o. Polices des glyphes :
APHRODY_SYMBOLS_DIR, sinon packages/m3-fonts/fonts/upstream/material-symbols du checkout Material, sinon le CDN.
";

/// Entry point of `aphrody identity charger`. `args[0]` is the program name.
pub fn charger_main(args: Vec<OsString>) -> i32 {
    let args: Vec<String> = args.iter().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    match executer(args) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("charger: {e}");
            1
        },
    }
}

fn valeur(args: &mut Vec<String>, nom: &str) -> Result<Option<String>, String> {
    let Some(i) = args.iter().position(|a| a == nom) else {
        return Ok(None);
    };
    if i + 1 >= args.len() {
        return Err(format!("{nom} attend une valeur"));
    }
    let v = args.remove(i + 1);
    args.remove(i);
    Ok(Some(v))
}

fn drapeau(args: &mut Vec<String>, nom: &str) -> bool {
    args.iter().position(|a| a == nom).is_some_and(|i| {
        args.remove(i);
        true
    })
}

fn executer(mut args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || drapeau(&mut args, "--help") || drapeau(&mut args, "-h") {
        print!("{AIDE}");
        return Ok(());
    }
    let mut requete = Request::default();
    if let Some(t) = valeur(&mut args, "--taille")? {
        requete.size = Some(t.parse().map_err(|_| format!("--taille {t} : entier attendu"))?);
    }
    if let Some(e) = valeur(&mut args, "--echelle")? {
        requete.scale = e.parse().map_err(|_| format!("--echelle {e} : nombre attendu"))?;
    }
    if let Some(c) = valeur(&mut args, "--teinte")? {
        requete.tint = Some(couleur(&c).ok_or_else(|| format!("--teinte {c} : #RRGGBB attendu"))?);
    }
    if let Some(a) = valeur(&mut args, "--ajustement")? {
        requete.fit = Fit::parse(&a)
            .ok_or_else(|| format!("--ajustement {a} : contain, cover, fill ou none"))?;
    }
    if drapeau(&mut args, "--svg") {
        requete.output = Output::Svg;
    }
    let sortie = valeur(&mut args, "-o")?;
    let json = drapeau(&mut args, "--json");
    let [spec] = args.as_slice() else {
        return Err(format!("une seule source attendue, reçu {args:?}\n\n{AIDE}"));
    };
    let source = Source::parse(spec).map_err(|e| e.to_string())?;

    let debut = Instant::now();
    let charge = Loader::from_env().load(&source, &requete).map_err(|e| e.to_string())?;
    let ms = debut.elapsed().as_secs_f64() * 1000.0;

    let (largeur, hauteur) = match &charge.contenu {
        Contenu::Rgba(img) => {
            let f = sortie.as_deref().ok_or("une sortie RGBA s'écrit en PNG : -o FICHIER.png")?;
            let png = crate::assets::encoder_png(&img.rgba, img.largeur, img.hauteur)
                .map_err(|e| e.to_string())?;
            std::fs::write(f, png).map_err(|e| format!("{f} : {e}"))?;
            (img.largeur, img.hauteur)
        },
        Contenu::Svg(svg) => {
            match sortie.as_deref() {
                Some(f) => std::fs::write(f, svg).map_err(|e| format!("{f} : {e}"))?,
                None => println!("{svg}"),
            }
            (0, 0)
        },
    };
    let empreinte: String = charge.empreinte[..8].iter().map(|b| format!("{b:02x}")).collect();
    let resume = serde_json::json!({
        "format": charge.format.as_str(),
        "intrinseque": [charge.intrinseque.0, charge.intrinseque.1],
        "sortie": if largeur == 0 { serde_json::Value::Null } else { serde_json::json!([largeur, hauteur]) },
        "entrees": charge.entrees.iter().map(|e| serde_json::json!({
            "largeur": e.largeur, "hauteur": e.hauteur, "bits": e.bits, "png": e.png
        })).collect::<Vec<_>>(),
        "entree": charge.entree,
        "empreinte": empreinte,
        "ms": (ms * 100.0).round() / 100.0,
    });
    if json {
        println!("{resume}");
    } else if sortie.is_some() {
        eprintln!("{resume}");
    }
    Ok(())
}
